module.exports = function (RED) {
    "use strict";
    var bodyParser = require('body-parser');
    var cookieParser = require('cookie-parser');
    var getBody = require('raw-body');
    var typer = require('content-type');
    var mediaTyper = require('media-typer');
    var isUtf8 = require('is-utf8');
    var multer = require('multer');
    var hashSum = require('hash-sum');

    function rawBodyParser(req, res, next) {
        if (req.skipRawBodyParser) { next(); } // don't parse node if told to skip
        if (req._body) { return next(); }
        req.body = "";
        req._body = true;

        var isText = true;
        var checkUTF = false;

        if (req.headers['content-type']) {
            var contentType = typer.parse(req.headers['content-type'])
            if (contentType.type) {
                var parsedType = mediaTyper.parse(contentType.type);
                if (parsedType.type === "text") {
                    isText = true;
                } else if (parsedType.subtype === "xml" || parsedType.suffix === "xml") {
                    isText = true;
                } else if (parsedType.type !== "application") {
                    isText = false;
                } else if (parsedType.subtype !== "octet-stream"
                    && (parsedType.subtype !== "cbor")
                    && (parsedType.subtype !== "x-protobuf")) {
                    checkUTF = true;
                } else {
                    // application/octet-stream
                    isText = false;
                }

            }
        }

        getBody(req, {
            length: req.headers['content-length'],
            encoding: isText ? "utf8" : null
        }, function (err, buf) {
            if (err) { return next(err); }
            if (!isText && checkUTF && isUtf8(buf)) {
                buf = buf.toString()
            }
            req.body = buf;
            next();
        });
    }
    function createRequestWrapper(node, req) {
        // node misses a bunch of properties (eg headers). Before we use node function
        // need to ensure it captures everything documented by Express and HTTP modules.
        var wrapper = {
            _req: req
        };
        var toWrap = [
            "param",
            "get",
            "is",
            "acceptsCharset",
            "acceptsLanguage",
            "app",
            "baseUrl",
            "body",
            "cookies",
            "fresh",
            "hostname",
            "ip",
            "ips",
            "originalUrl",
            "params",
            "path",
            "protocol",
            "query",
            "route",
            "secure",
            "signedCookies",
            "stale",
            "subdomains",
            "xhr",
            "socket"
        ];
        toWrap.forEach(function (f) {
            if (typeof req[f] === "function") {
                wrapper[f] = function () {
                    node.warn(RED._("httpin.errors.deprecated-call", { method: "msg.req." + f }));
                    var result = req[f].apply(req, arguments);
                    if (result === req) {
                        return wrapper;
                    } else {
                        return result;
                    }
                }
            } else {
                wrapper[f] = req[f];
            }
        });


        return wrapper;
    }
    function createResponseWrapper(node, res) {
        var wrapper = {
            _res: res
        };
        var toWrap = [
            "append",
            "attachment",
            "cookie",
            "clearCookie",
            "download",
            "end",
            "format",
            "get",
            "json",
            "jsonp",
            "links",
            "location",
            "redirect",
            "render",
            "send",
            "sendfile",
            "sendFile",
            "sendStatus",
            "set",
            "status",
            "type",
            "vary"
        ];
        toWrap.forEach(function (f) {
            wrapper[f] = function () {
                node.warn(RED._("httpin.errors.deprecated-call", { method: "msg.res." + f }));
                var result = res[f].apply(res, arguments);
                if (result === res) {
                    return wrapper;
                } else {
                    return result;
                }
            }
        });
        return wrapper;
    }

    function HTTPInstIn(config) {
        RED.nodes.createNode(this, config);

        const node = this;

        if (!config.url) {
            node.warn('No path found');
            return;
        }

        if (!config.server) {
            node.warn('Server not set');
            return;
        }

        node.url = config.url;
        if (node.url[0] !== '/') {
            node.url = '/' + node.url;
        }
        node.method = config.method;
        node.upload = config.upload;

        if (typeof config.server === 'string') {
            node.app = RED.nodes.getNode(config.server).app;
        } else {
            node.app = config.server.app;
        }


        const errorHandler = (err, req, res, next) => {
            node.warn(err);
            res.sendStatus(500);
        };

        const callback = (req, res) => {
            var msgid = RED.util.generateId();
            res._msgid = msgid;
            if (node.method.match(/^(post|delete|put|options|patch)$/)) {
                node.send({ _msgid: msgid, req: req, res: createResponseWrapper(node, res), payload: req.body });
            } else if (node.method == 'get') {
                node.send({ _msgid: msgid, req: req, res: createResponseWrapper(node, res), payload: req.query });
            } else {
                node.send({ _msgid: msgid, req: req, res: createResponseWrapper(node, res) });
            }
        }

        var multipartParser = (req, res, next) => { next(); }
        if (node.upload) {
            var mp = multer({ storage: multer.memoryStorage() }).any();
            multipartParser = (req, res, next) => {
                mp(req, res, (err) => {
                    req._body = true;
                    next(err);
                })
            };
        }

        const maxApiRequestSize = RED.settings.apiMaxLength || config.maxApiRequestSize || '5mb';
        const jsonParser = bodyParser.json({ limit: maxApiRequestSize });
        const urlencParser = bodyParser.urlencoded({ limit: maxApiRequestSize, extended: true });

        if (node.method == 'get') {
            node.app.get(node.url, cookieParser(), callback, errorHandler);
        } else if (node.method == 'post') {
            node.app.post(node.url, cookieParser(), jsonParser, urlencParser, multipartParser, rawBodyParser, callback, errorHandler);
        } else if (node.method == 'put') {
            node.app.put(node.url, cookieParser(), jsonParser, urlencParser, rawBodyParser, callback, errorHandler);
        } else if (node.method == 'patch') {
            node.app.patch(node.url, cookieParser(), jsonParser, urlencParser, rawBodyParser, callback, errorHandler);
        } else if (node.method == 'delete') {
            node.app.delete(node.url, cookieParser(), jsonParser, urlencParser, rawBodyParser, callback, errorHandler);
        }

        node.on('close', () => {
            node.app._router.stack.forEach((route, i, routes) => {
                if (route.route && route.route.path === node.url && route.route.methods[node.method]) {
                    routes.splice(i, 1);
                }
            });
        });
    }

    RED.nodes.registerType('http-inst-in', HTTPInstIn);


    function HTTPInstOut(config) {
        RED.nodes.createNode(this, config);

        const node = this;
        node.headers = node.headers || {};
        node.statusCode = node.statusCode;
        node.on('input', (msg, send, done) => {
            if (msg.res) {
                var headers = RED.util.cloneMessage(node.headers);
                if (msg.headers) {
                    if (msg.headers.hasOwnProperty('x-node-red-request-node')) {
                        var headerHash = msg.headers['x-node-red-request-node'];
                        delete msg.headers['x-node-red-request-node'];
                        var hash = hashSum(msg.headers);
                        if (hash === headerHash) {
                            delete msg.headers;
                        }
                    }
                    if (msg.headers) {
                        for (var h in msg.headers) {
                            if (msg.headers.hasOwnProperty(h) && !headers.hasOwnProperty(h)) {
                                headers[h] = msg.headers[h];
                            }
                        }
                    }
                }
                if (Object.keys(headers).length > 0) {
                    msg.res._res.set(headers);
                }
                if (msg.cookies) {
                    for (var name in msg.cookies) {
                        if (msg.cookies.hasOwnProperty(name)) {
                            if (msg.cookies[name] === null || msg.cookies[name].value === null) {
                                if (msg.cookies[name] !== null) {
                                    msg.res._res.clearCookie(name, msg.cookies[name]);
                                } else {
                                    msg.res._res.clearCookie(name);
                                }
                            } else if (typeof msg.cookies[name] === 'object') {
                                msg.res._res.cookie(name, msg.cookies[name].value, msg.cookies[name]);
                            } else {
                                msg.res._res.cookie(name, msg.cookies[name]);
                            }
                        }
                    }
                }
                var statusCode = node.statusCode || msg.statusCode || 200;
                if (typeof msg.payload == 'object' && !Buffer.isBuffer(msg.payload)) {
                    msg.res._res.status(statusCode).jsonp(msg.payload);
                } else {
                    if (msg.res._res.get('content-length') == null) {
                        var len;
                        if (msg.payload == null) {
                            len = 0;
                        } else if (Buffer.isBuffer(msg.payload)) {
                            len = msg.payload.length;
                        } else if (typeof msg.payload == 'number') {
                            len = Buffer.byteLength('' + msg.payload);
                        } else {
                            len = Buffer.byteLength(msg.payload);
                        }
                        msg.res._res.set('content-length', len);
                    }

                    if (typeof msg.payload === 'number') {
                        msg.payload = '' + msg.payload;
                    }
                    msg.res._res.status(statusCode).send(msg.payload);
                }
            } else {
                node.warn('Response not found');
            }
        });
    }

    RED.nodes.registerType('http-inst-out', HTTPInstOut);
}