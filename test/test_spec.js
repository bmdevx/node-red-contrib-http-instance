const should = require("should");
const helper = require("node-red-node-test-helper");
const node_server = require("../nodes/node-inst-server");
const node_in_out = require("../nodes/node-in-out");

helper.init(require.resolve('node-red'));

describe('http nodes', function () {

    beforeEach(function (done) {
        helper.startServer(done);
    });

    afterEach(function (done) {
        helper.unload();
        helper.stopServer(done);
    });

    it('should be loaded', function (done) {
        var flow = [{ id: "serv", type: "node-inst-server", name: "node-inst-server", port: 8080 },
        { id: "nin", type: "http-inst-in", name: "http-inst-in" },
        { id: "nout", type: "http-inst-out", name: "http-inst-out", server: "serv", url: "/test", method: "get" }];

        helper.load([node_server, node_in_out], flow, function () {
            var n1 = helper.getNode("serv");
            n1.should.have.property('name', 'node-inst-server');

            var n2 = helper.getNode("nin");
            n2.should.have.property('name', 'http-inst-in');

            var n3 = helper.getNode("nout");
            n3.should.have.property('name', 'http-inst-out');

            done();
        });
    });

    it('test-send-recv', function (done) {
        var flow = [{
            id: "serv", type: "node-inst-server", name: "node-inst-server", port: 8080
        },
        { id: "nout", type: "http-inst-out", name: "http-inst-out" },
        { id: "nin", type: "http-inst-in", name: "http-inst-in", wires: [["nout"]], server: "serv", url: "/test", method: "get" }];

        helper.load([node_server, node_in_out], flow, {
        }, function () {
            var serv = helper.getNode("serv");
            var nin = helper.getNode("nin");
            var nout = helper.getNode("nout");

            const fdone = done;

            nout.on("input", function (msg, send, done) {
                done();

                if (msg.payload.value === "close") {
                    fdone();
                }
            });
        });
    }).timeout(60000);
});