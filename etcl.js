/**
 * @author  wehjin
 * @since   8/27/15
 */
(function (deps, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        var v = factory(require, exports); if (v !== undefined) module.exports = v;
    }
    else if (typeof define === 'function' && define.amd) {
        define(deps, factory);
    }
})(["require", "exports", "rxts", "et", "fs", "open", "prompt"], function (require, exports) {
    ///<reference path="node_modules/rxts/rxts.d.ts"/>
    ///<reference path="./typings/node/node.d.ts" />
    ///<reference path="./typings/open/open.d.ts" />
    ///<reference path="./typings/prompt/prompt.d.ts" />
    var rxts_1 = require("rxts");
    var et_1 = require("et");
    var fs = require("fs");
    var open = require("open");
    var prompt = require("prompt");
    function readSetup(filepath) {
        return rxts_1.Observable.create(function (subscriber) {
            fs.readFile(filepath, function (err, data) {
                if (err) {
                    subscriber.onError(err);
                    return;
                }
                subscriber.onNext(data.toString('utf8'));
                subscriber.onCompleted();
            });
        }).map(function (s) {
            return JSON.parse(s);
        });
    }
    function getAccessCredential(requestToken) {
        return rxts_1.Observable.create(function (subscriber) {
            var subscription = new rxts_1.BooleanSubscription();
            open(requestToken.getAuthenticationUrl());
            prompt.start();
            prompt.get(['verifier'], function (err, result) {
                if (subscriber.isUnsubscribed()) {
                    return;
                }
                if (err) {
                    subscriber.onError(err);
                }
                else {
                    var verifier = result['verifier'].trim();
                    if (verifier.length === 0) {
                        subscriber.onError(new Error("no verifier"));
                        return;
                    }
                    subscriber.onNext(new et_1.Credentials(verifier, requestToken));
                    subscriber.onCompleted();
                }
            });
            return subscription;
        });
    }
    var setup = readSetup(process.env['HOME'] + '/.etcl/setup.json');
    var buildService = setup.map(function (setup) {
        return new et_1.Service(setup);
    });
    var fetchRequestToken = buildService.flatMap(function (service) {
        return service.fetchRequestToken();
    });
    fetchRequestToken
        .flatMap(function (requestToken) {
        return getAccessCredential(requestToken);
    })
        .flatMap(function (credentials) {
        return credentials.getAccessToken();
    })
        .subscribe(function (result) {
        console.log(result);
    }, function (e) {
        console.error(e);
    });
});
//# sourceMappingURL=etcl.js.map