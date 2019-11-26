ARG NODEVERSION=10
FROM node:${NODEVERSION}

# Clone the projects into the docker container and compile it
ENV NODE_ENV=production
RUN yarn global add typescript
RUN git clone https://github.com/Coinversable/validana-server.git#v1.0.1 /usr/node
RUN yarn --cwd /usr/node install
RUN tsc -p /usr/node/tsconfig.json

# Add environment variables
#ENV VSERVER_API={\"v1\":\"/usr/node/dist/basics/basichandler.js\"}
#ENV VSERVER_RESTPORT=
#ENV VSERVER_WSPORT=
#ENV VSERVER_TLS=
#ENV VSERVER_KEYPATH=
#ENV VSERVER_CERTPATH=
#ENV VSERVER_DBPASSWORD=
#ENV VSERVER_DBUSER=
#ENV VSERVER_DBNAME=
#ENV VSERVER_DBHOST=
#ENV VSERVER_WORKERS=
#ENV VSERVER_LOGLEVEL=
#ENV VSERVER_DBPORT=
#ENV VSERVER_MAXMEMORY=
#ENV VSERVER_UPDATEINTERVAL=
#ENV VSERVER_TIMEOUT=
#ENV VSERVER_SENTRYURL=

#Add user and entry point
USER node
ENTRYPOINT node -e "require('/usr/node/dist/app.js').start()" dist/app.js