FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY mock-render-node.js ./
CMD ["npm", "start"]
