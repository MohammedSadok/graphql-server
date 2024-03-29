import { makeExecutableSchema } from "@graphql-tools/schema";
import { ApolloServer, gql } from "apollo-server-express";
import express from "express";
import { execute, subscribe } from "graphql";
import { composeWithMongoose } from "graphql-compose-mongoose";
import { PubSub } from "graphql-subscriptions";
import { createServer } from "http";
import mongoose from "mongoose";
import { SubscriptionServer } from "subscriptions-transport-ws";
import { v4 } from "uuid";

(async () => {
  // Connect to MongoDB locally
  await mongoose.connect("mongodb://localhost:27017/graph", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  // Define MongoDB Schema
  const MessageSchema = new mongoose.Schema({
    id: String,
    name: String,
    content: String,
  });
  // Create MongoDB Model
  const MessageModel = mongoose.model("Message", MessageSchema);
  // Integrate mongoose with GraphQL schema
  const MessageTC = composeWithMongoose(MessageModel, {});

  const pubsub = new PubSub();
  const app = express();
  const httpServer = createServer(app);

  const typeDefs = gql`
    type Query {
      viewMessages: [Message!]
      getMessage(id: ID!): Message
    }
    type Mutation {
      sendMessage(name: String!, content: String!): Message!
      updateMessage(id: ID!, content: String!, name: String!): Message
      deleteMessage(id: ID!): ID
    }
    type Subscription {
      receiveMessage: Message!
      receiveMessageForUser(name: String!): Message!
    }
    type Message {
      id: ID!
      name: String!
      content: String!
    }
  `;

  const resolvers = {
    Query: {
      viewMessages: async () => {
        try {
          const messages = await MessageModel.find();
          return messages;
        } catch (error) {
          throw new Error("Failed to fetch messages");
        }
      },
      getMessage: (_, { id }) => MessageModel.findById(id),
    },
    Mutation: {
      sendMessage: (_, { name, content }) => {
        const id = v4();
        const newMessage = new MessageModel({ id, name, content });
        pubsub.publish("MessageService", { receiveMessage: newMessage });
        return newMessage.save();
      },
      updateMessage: async (_, { id, content, name }) => {
        try {
          await MessageModel.updateOne(
            { id: id },
            { $set: { content: content, name: name } }
          );
          const updatedMessage = await MessageModel.findOne({ id: id });
          if (!updatedMessage) {
            throw new Error("Message not found after update");
          }
          return updatedMessage;
        } catch (error) {
          console.error("Failed to update message:", error);
          throw new Error("Failed to update message");
        }
      },
      deleteMessage: async (_, { id }) => {
        try {
          const deletedMessage = await MessageModel.deleteOne({ _id: id });
          if (!deletedMessage) {
            throw new Error("Message not found");
          }
          return id;
        } catch (error) {
          console.error("Failed to delete message:", error);
          throw new Error("Failed to delete message");
        }
      },
    },
    Subscription: {
      receiveMessage: {
        subscribe: () => pubsub.asyncIterator(["MessageService"]),
      },
    },
  };

  const schema = makeExecutableSchema({ typeDefs, resolvers });
  const server = new ApolloServer({
    schema,
  });
  await server.start();
  server.applyMiddleware({ app });

  SubscriptionServer.create(
    { schema, execute, subscribe },
    { server: httpServer, path: "/graphql" }
  );

  const PORT = 4000;
  httpServer.listen(PORT, () => {
    console.log(
      `🚀 Query endpoint ready at http://localhost:${PORT}${server.graphqlPath}`
    );
    console.log(
      `🚀 Subscription endpoint ready at ws://localhost:${PORT}${server.graphqlPath}`
    );
  });
})();
