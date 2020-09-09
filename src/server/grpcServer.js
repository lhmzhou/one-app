import express from 'express';
import socketio from 'socket.io';
import http from 'http';
import { credentials, loadPackageDefinition } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import protobuf from 'protobufjs';

import protoDescriptor from '../../../chaos-gui/src/service.proto.json';

const app = express();
const httpServer = http.createServer(app);
const socket = socketio(httpServer);
const serviceDescriptor = protobuf.Root.fromJSON(protoDescriptor);
const clients = {};

function getServiceMethods() {
  return Object.keys(protoDescriptor.nested)
    .filter((service) => protoDescriptor.nested[service].methods !== undefined)
    .map((service) => ({
      serviceName: service,
      serviceMethods: protoDescriptor.nested[service].methods,
    }));
}


function mapServiceMethodsToFunctions(next, prev) {
  Object.keys(next.serviceMethods)
    .forEach((method) => {
      // eslint-disable-next-line no-param-reassign
      prev[next.serviceName][method] = (
        io = undefined,
        message = {},
        responseHandler = console.log
      ) => {
        if (io === undefined) throw new Error('socket must be defined.');
        io[next.serviceName][method](message, responseHandler);
      };
    });
  return prev;
}

function functions() {
  return getServiceMethods()
    .reduce((prev, next) => mapServiceMethodsToFunctions(next, prev), clients);
}

export default function createGrpcServer() {
  let protoDefs;
  const creds = credentials.createInsecure();
  let orchestratorClient;

  function addClient(message) {
    console.log('chaos orchesatrator calling add client.', message);
    orchestratorClient.addClient(message, (err, orchestratorNodeconfig) => {
      console.log('chaos orchesatrator returned.');
      if (err) console.error('call to grpc server for add client failed', err);
      else console.log('recieved the resulting node config.', orchestratorNodeconfig);
    });
  }

  function intertangle(message, responseHandler) {
    const server = orchestratorClient.intertangle(message);
    server.on('data', responseHandler);
    server.on('end', console.log);
    server.on('error', console.log);
    server.on('status', console.log);
    server.write(message);
    server.end();
  }

  function getProtoDefintion(path) {
    const packageDefinition = loadSync(
      path,
      {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });
    return packageDefinition;
  }

  function loadGrpcClient() {
    const packageDefinition = getProtoDefintion(`${__dirname}../../../../../../chaos.engine/src/main/proto/service.proto`);
    protoDefs = loadPackageDefinition(packageDefinition);
    orchestratorClient = new protoDefs.ChaosOrchestrator('localhost:62223', creds);
  }

  loadGrpcClient();

  function mapToArray(data) {
    return [...Object.keys(data).map((key) => data[key]).reduce((accum, next) => [...accum, next], [])];
  }
  console.log('Starting GRPC Proxy Server...');

  socket.on('connection', (io) => {
    console.log('New connection established');
    io.on('alive', console.log);
    io.on('error', (err) => console.error(`WebSocket Error: ${err.message}`));

    const service = 'ChaosOrchestrator';

    io.on(`${service}.intertangle`, (data) => {
      console.log('intertangle recieved', Array.isArray(data), data);
      const message = serviceDescriptor
        .lookup('IMessage')
        .decode(mapToArray(data));
      intertangle(message, console.log);
    });

    io.on(`${service}.addClient`, (data) => {
      console.log('addClient recieved', Array.isArray(data), data);
      const newClient = serviceDescriptor
        .lookup('OrchestratorNodeConfig')
        .decode(mapToArray(data));
      addClient(newClient);
    });
  });
  socket.on('error', (err) => console.error(`WebSocket Error: ${err.message}`));
  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
  return httpServer;
}
