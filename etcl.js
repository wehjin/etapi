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
    function readAccessToken(service) {
        return readJson(accessTokenPath)
            .map(function (json) {
            return new et_1.AccessToken(json['token'], json['secret'], json['flags'], service);
        });
    }
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
    var Asset = (function () {
        function Asset(assetId, symbol, typeCode) {
            this.positions = [];
            this.quantity = 0;
            this.marketValue = 0;
            this.currentPrice = 0;
            this.descriptions = [];
            this.assetId = assetId;
            this.symbol = symbol;
            this.typeCode = typeCode;
        }
        Asset.prototype.addPosition = function (position) {
            this.positions.push(position);
            this.quantity += parseFloat(position['qty']);
            this.marketValue += parseFloat(position['marketValue']);
            this.currentPrice = parseFloat(position['currentPrice']);
            this.descriptions.push(position['description']);
        };
        Asset.prototype.report = function () {
            return this.symbol + ":" + this.typeCode + ": $ " + this.marketValue.toFixed(2) + "\n";
        };
        return Asset;
    })();
    var Assets = (function () {
        function Assets(accountList) {
            this.assets = {};
            for (var i = 0; i < accountList.accounts.length; i++) {
                var account = accountList.accounts[i];
                for (var i = 0; i < account.positions.length; i++) {
                    this.addPosition(account.positions[i]);
                }
            }
            var cash = accountList.getCash();
            var cashPosition = {
                productId: {
                    symbol: 'USD',
                    typeCode: 'CUR'
                },
                description: 'US Dollars',
                qty: cash,
                currentPrice: 1,
                marketValue: cash
            };
            this.addPosition(cashPosition);
            this.accountList = accountList;
        }
        Assets.prototype.getAssetList = function () {
            var assets = {};
            for (var key in this.assets) {
                assets.push(this.assets[key]);
            }
            return assets;
        };
        Assets.prototype.addPosition = function (position) {
            var productId = position['productId'];
            if (!productId) {
                console.error("Position missing product id:", position);
                return;
            }
            var symbol = productId['symbol'];
            var typeCode = productId['typeCode'];
            var assetId = JSON.stringify({
                symbol: symbol,
                typeCode: typeCode
            });
            var asset = this.assets[assetId];
            if (!asset) {
                asset = new Asset(assetId, symbol, typeCode);
                this.assets[assetId] = asset;
            }
            asset.addPosition(position);
        };
        Assets.prototype.report = function () {
            var report = '';
            var array = [];
            for (var assetId in this.assets) {
                array.push(this.assets[assetId]);
            }
            array.sort(function (a, b) {
                return a.symbol.localeCompare(b.symbol);
            });
            for (var i = 0; i < array.length; i++) {
                var asset = array[i];
                report += asset.report();
            }
            report += ":: " + this.accountList.date;
            return report;
        };
        return Assets;
    })();
    var UnassignedAssetError = (function () {
        function UnassignedAssetError(asset) {
            this.asset = asset;
            this.name = "UnassignedAsset";
            this.message = "No or invalid target assigned to asset: " + asset;
        }
        return UnassignedAssetError;
    })();
    var Progress = (function () {
        function Progress(targets, assignments, assets) {
            this.scores = {};
            for (var i = 0; i < targets.length; i++) {
                var target = targets[i];
                this.scores[target.targetId] = {
                    target: target,
                    assets: []
                };
            }
            var assetList = assets.getAssetList();
            for (var i = 0; i < assetList.length; i++) {
                var asset = assetList[i];
                var assetId = asset.assetId;
                var targetId = assignments[assetId];
                if (!targetId) {
                    throw new UnassignedAssetError(asset);
                }
                var score = this.scores[targetId];
                if (!score) {
                    throw new UnassignedAssetError(asset);
                }
                score.assets.push(asset);
            }
        }
        return Progress;
    })();
    function main() {
        var accessToken = readJson(setupPath)
            .map(function (setup) {
            return new et_1.Service(setup);
        })
            .flatMap(function (service) {
            return readOrFetchAccessToken(service);
        });
        readOrFetchAccountList(accessToken)
            .map(function (accountList) {
            return new Assets(accountList);
        })
            .map(function (assets) {
            return assets.report();
        })
            .subscribe(function (result) {
            console.log(result);
        }, function (e) {
            console.error(e);
        }, function () {
        });
    }
    main();
});
//# sourceMappingURL=etcl.js.map