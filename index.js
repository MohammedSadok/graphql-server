import { makeExecutableSchema } from "@graphql-tools/schema";
import { ApolloServer, gql } from "apollo-server-express";
import express from "express";
import { execute, subscribe } from "graphql";
import { PubSub } from "graphql-subscriptions";
import { createServer } from "http";
import { SubscriptionServer } from "subscriptions-transport-ws";
import { v4 } from "uuid";
(async () => {
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
      updateMessage(id: ID!, content: String!): Message
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

  let messages = [];

  const resolvers = {
    Query: {
      viewMessages() {
        return messages;
      },
      getMessage: (parent, { id }) => {
        return messages.find((message) => message.id === id);
      },
    },
    Mutation: {
      sendMessage: (parent, { name, content }) => {
        const id = v4();
        const newMessage = {
          id,
          name,
          content,
        };
        messages.push(newMessage);
        pubsub.publish("MessageService", { receiveMessage: newMessage });
        pubsub.publish(`MessageForUser:${name}`, {
          receiveMessageForUser: newMessage,
        });
        return newMessage;
      },
      updateMessage: (parent, { id, content }) => {
        const index = messages.findIndex((message) => message.id === id);
        if (index === -1) {
          throw new Error("Message not found");
        }
        messages[index].content = content;
        pubsub.publish("MessageService", { receiveMessage: messages[index] });
        return messages[index];
      },
      deleteMessage: (parent, { id }) => {
        const index = messages.findIndex((message) => message.id === id);
        if (index === -1) {
          throw new Error("Message not found");
        }
        const deletedId = messages[index].id;
        messages = messages.filter((message) => message.id !== id);
        return deletedId;
      },
    },
    Subscription: {
      receiveMessage: {
        subscribe: () => pubsub.asyncIterator(["MessageService"]),
      },
      receiveMessageForUser: {
        subscribe: (_parent, { name }) =>
          pubsub.asyncIterator([`MessageForUser:${name}`]),
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
