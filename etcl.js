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
    var homePath = process.env['HOME'];
    var prefPath = homePath + '/.etcl';
    var setupPath = prefPath + '/setup.json';
    var accessTokenPath = prefPath + "/accessToken.json";
    var accountListPath = prefPath + "/accountList.json";
    var NoEntryError = (function () {
        function NoEntryError(message) {
            this.name = "NoEntryError";
            this.message = message;
        }
        return NoEntryError;
    })();
    function readJson(filepath) {
        return rxts_1.Observable.create(function (subscriber) {
            fs.readFile(filepath, function (err, data) {
                if (err) {
                    if (err['code'] === 'ENOENT') {
                        subscriber.onError(new NoEntryError(JSON.stringify(err)));
                    }
                    else {
                        subscriber.onError(err);
                    }
                    return;
                }
                subscriber.onNext(data.toString('utf8'));
                subscriber.onCompleted();
            });
        }).map(function (s) {
            return JSON.parse(s);
        });
    }
    function saveJson(jsonable, filePath) {
        return rxts_1.Observable.create(function (subscriber) {
            var subscription = new rxts_1.BooleanSubscription();
            fs.writeFile(filePath, jsonable.toJson(), {
                mode: 0600
            }, function (err) {
                if (subscription.isUnsubscribed()) {
                    return;
                }
                if (err) {
                    subscriber.onError(err);
                    return;
                }
                subscriber.onNext(jsonable);
                subscriber.onCompleted();
            });
        });
    }
    function deleteJson(path) {
        return rxts_1.Observable.create(function (subscriber) {
            var subscription = new rxts_1.BooleanSubscription();
            fs.unlink(path, function (err) {
                if (subscription.isUnsubscribed()) {
                    return;
                }
                if (err) {
                    subscriber.onError(err);
                    return;
                }
                subscriber.onNext(true);
                subscriber.onCompleted();
            });
        });
    }
    function askHumanForAccessCredentials(requestToken) {
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
    function fetchAccessToken(service) {
        return service.fetchRequestToken()
            .flatMap(function (requestToken) {
            return askHumanForAccessCredentials(requestToken);
        })
            .flatMap(function (credentials) {
            return credentials.getAccessToken();
        })
            .flatMap(function (accessToken) {
            return saveJson(accessToken, accessTokenPath);
        });
    }
    var readAccessToken = function (service) {
        return readJson(accessTokenPath)
            .map(function (json) {
            return new et_1.AccessToken(json['token'], json['secret'], json['flags'], service);
        });
    };
    function readOrFetchAccessToken(service) {
        return readAccessToken(service)
            .onErrorResumeNext(function (e) {
            if (e instanceof NoEntryError) {
                return fetchAccessToken(service);
            }
            else {
                return rxts_1.Observable.error(e);
            }
        });
    }
    function fetchAccountList(accessToken) {
        var fetchBaseAccountList = accessToken
            .flatMap(function (accessToken) {
            return accessToken.fetchAccountList();
        });
        return fetchBaseAccountList
            .onErrorResumeNext(function (e) {
            if (e instanceof et_1.TokenError) {
                return deleteJson(accessTokenPath).flatMap(function () {
                    return fetchBaseAccountList;
                });
            }
            else {
                return rxts_1.Observable.error(e);
            }
        })
            .flatMap(function (accountList) {
            return accountList.refreshBalances();
        })
            .flatMap(function (accountList) {
            return accountList.refreshPositions();
        })
            .flatMap(function (accountList) {
            return saveJson(accountList, accountListPath);
        });
    }
    function readAccountList(accessToken) {
        return accessToken
            .flatMap(function (accessToken) {
            return readJson(accountListPath)
                .map(function (jsonAccountList) {
                return et_1.AccountList.fromJson(jsonAccountList, accessToken);
            });
        });
    }
    function readOrFetchAccountList(accessToken) {
        return readAccountList(accessToken)
            .onErrorResumeNext(function (e) {
            if (e instanceof NoEntryError) {
                return fetchAccountList(accessToken);
            }
            else {
                return rxts_1.Observable.error(e);
            }
        });
    }
    function main() {
        var accessToken = readJson(setupPath)
            .map(function (setup) {
            return new et_1.Service(setup);
        })
            .flatMap(function (service) {
            return readOrFetchAccessToken(service);
        });
        var accountList = readOrFetchAccountList(accessToken);
        accountList
            .map(function (accountList) {
            return accountList.getCash();
        })
            .subscribe(function (result) {
            console.log(result);
        }, function (e) {
            console.error(e);
        });
    }
    main();
});
//# sourceMappingURL=etcl.js.map