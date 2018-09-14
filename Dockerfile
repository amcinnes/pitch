FROM node:8-alpine
RUN npm install -g http-server
CMD ["http-server"]
