ARG NODEVERSION=12
FROM node:${NODEVERSION}

# Clone the projects into the docker container and compile it
ENV NODE_ENV=production
ENV NODE_NO_WARNINGS=1
RUN git clone https://github.com/Coinversable/validana-server.git --branch v2.1.0 /usr/node
RUN yarn --cwd /usr/node install --frozen-lockfile

# Add certificate if wanted
#ENV VSERVER_TLS=true
#ENV VSERVER_KEYPATH=/usr/node/certificates/mycert.key
#ENV VSERVER_CERTPATH=/usr/node/certificates/mycert.cert
# Copy the certificate into the container. Alternately start the container with: -v ~./certificates:/usr/node/certificates
#COPY ./certificates/mycert.key /usr/node/certificates/mycert.key
#COPY ./certificates/mycert.cert /usr/node/certificates/mycert.cert

# Add other environment variables
#ENV VSERVER_HTTPPORT=8080
#ENV VSERVER_WSPORT=8080
#ENV VSERVER_DBPASSWORD=
#ENV VSERVER_DBUSER=backend
#ENV VSERVER_DBNAME=blockchain
#ENV VSERVER_DBHOST=localhost
#ENV VSERVER_DBMINCONNECTIONS=0
#ENV VSERVER_DBMAXCONNECTIONS=10
#ENV VSERVER_WORKERS=-1
#ENV VSERVER_LOGLEVEL=0
#ENV VSERVER_DBPORT=5432
#ENV VSERVER_MAXMEMORY=1024
#ENV VSERVER_TIMEOUT=60
#ENV VSERVER_MAXPAYLOADSIZE=1000000
#ENV VSERVER_CACHING=true
#ENV VSERVER_SENTRYURL=
# Also available: $severity
#ENV VSERVER_LOGFORMAT $color$timestamp: $message: $error

#Add user and entry point
USER node
WORKDIR /usr/node
ENTRYPOINT ["node", "-e", "require('./dist/index.js').start(new Map().set('v1',new (require('./dist/basics/basichandler.js').default)()))", "dist/index.js"]