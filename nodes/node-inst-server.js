module.exports = function (RED) {
    "use strict";

    const express = require('express');
    const http = require('http');
    const https = require('https');
    const fs = require('fs');

    function InstServer(config) {
        RED.nodes.createNode(this, config);

        if (!config.port) {
            node.warn('Port Not Defined');
            return;
        }

        const node = this;

        node.name = config.name;
        node.port = config.port;

        const app = express();

        if (config.useHttps) {
            var cert, key;

            try {
                cert = fs.readFileSync(config.certPath, 'utf8');
            } catch (e) {
                node.warn(`Invalid Cert - ${e}`);
                return;
            }

            try {
                key = fs.readFileSync(config.keyPath, 'utf8');
            } catch (e) {
                node.warn(`Invalid Key - ${e}`);
                return;
            }

            node.server = https.createServer({
                cert: cert,
                key: key
            }, app);
        } else {
            node.server = http.createServer(app);
        }

        node.app = app;

        node.on('close', () => {
            node.server.close();
        })

        node.server.on('error', e => {
            node.warn(e);
        });

        node.server.listen(node.port, () => {
            node.debug(`${(node.name || `HTTP${config.useHttps ? 'S' : ''} Server`)} started on port ${node.port}.`);
        });
    }

    RED.nodes.registerType("node-inst-server", InstServer);
}