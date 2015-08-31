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
    var targetsPath = prefPath + "/targets.json";
    var assignmentsPath = prefPath + "/assignments.json";
    var accountIdSeparator = ":";
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
    function saveAny(toSave, filePath) {
        return rxts_1.Observable.create(function (subscriber) {
            var subscription = new rxts_1.BooleanSubscription();
            fs.writeFile(filePath, JSON.stringify(toSave), {
                mode: 0600
            }, function (err) {
                if (subscription.isUnsubscribed()) {
                    return;
                }
                if (err) {
                    subscriber.onError(err);
                    return;
                }
                subscriber.onNext(toSave);
                subscriber.onCompleted();
            });
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
        Assets.getAssetId = function (symbol, typeCode) {
            return JSON.stringify({
                symbol: symbol,
                typeCode: typeCode
            });
        };
        Assets.prototype.getAssetList = function () {
            var assets = [];
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
            var assetId = Assets.getAssetId(symbol, typeCode);
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
            this.name = "UnassignedAssetError";
            this.assetId = asset.symbol + accountIdSeparator + asset.typeCode;
            this.message = "No or invalid target for asset: " + this.assetId;
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
    function getAssets() {
        var accessToken = readJson(setupPath)
            .map(function (setup) {
            return new et_1.Service(setup);
        })
            .flatMap(function (service) {
            return readOrFetchAccessToken(service);
        });
        return readOrFetchAccountList(accessToken)
            .map(function (accountList) {
            return new Assets(accountList);
        });
    }
    function readTargets() {
        return readJson(targetsPath)
            .map(function (json) {
            return json;
        })
            .onErrorResumeNext(function (e) {
            return rxts_1.Observable.error(new Error("No targets - call setTarget"));
        });
    }
    function readAssignments() {
        return readJson(assignmentsPath)
            .onErrorResumeNext(function (e) {
            return (e instanceof NoEntryError) ? rxts_1.Observable.from([{}]) : rxts_1.Observable.error(e);
        });
    }
    var argIndex = 2;
    var commands = [];
    var currentCommand;
    var allArguments = {};
    function describeCommand(name, f) {
        commands.push(name);
        if (process.argv[argIndex] == name) {
            argIndex++;
            currentCommand = name;
            allArguments[currentCommand] = [];
            f();
        }
    }
    function describeArgument(name, example, f) {
        allArguments[currentCommand].push([name, example]);
        if (argIndex === process.argv.length) {
            throw "missing argument";
        }
        var arg = (typeof example === 'number') ?
            parseFloat(process.argv[argIndex++]) :
            process.argv[argIndex++];
        f(arg);
    }
    function describeProgram(name, f) {
        try {
            f();
        }
        catch (e) {
            if (e == "missing argument") {
                var argumentString = "";
                var commandArguments = allArguments[currentCommand];
                for (var i = 0; i < commandArguments.length; i++) {
                    if (i > 0) {
                        argumentString += " ";
                    }
                    argumentString += "<" + commandArguments[i][0] + ">";
                }
                console.log("Usage: " + name + " " + currentCommand + " " + argumentString);
            }
        }
        if (argIndex === 2) {
            console.log("Usage: " + name + "<command>");
            console.log("Commands: ");
            for (var c in commands) {
                console.log("  " + commands[c]);
            }
        }
    }
    function main() {
        describeProgram("etcl", function () {
            describeCommand("assignment", function () {
                var assetId;
                var targetId;
                describeArgument("assetId", "GOOG|EQ", function (arg) {
                    var symbolAndTypeCode = arg.split(accountIdSeparator);
                    assetId = Assets.getAssetId(symbolAndTypeCode[0], symbolAndTypeCode[1]);
                });
                describeArgument("targetId", "stocks", function (arg) {
                    targetId = arg;
                });
                readAssignments()
                    .map(function (assignments) {
                    assignments[assetId] = targetId;
                    return assignments;
                })
                    .flatMap(function (assignments) {
                    return saveAny(assignments, assignmentsPath);
                })
                    .subscribe(function (assignments) {
                    console.log(assignments);
                }, function (e) {
                    console.error(e);
                });
            });
            describeCommand("setTarget", function () {
                var targetName;
                var targetFraction;
                describeArgument("targetId", "stocks", function (arg) {
                    targetName = arg;
                });
                describeArgument("fraction", ".7", function (arg) {
                    targetFraction = arg;
                });
                readTargets()
                    .onErrorResumeNext(function (e) {
                    return rxts_1.Observable.from([[]]);
                })
                    .map(function (targets) {
                    targets.push({
                        targetId: targetName,
                        fraction: targetFraction
                    });
                    return targets;
                })
                    .flatMap(function (targets) {
                    return saveAny(targets, targetsPath);
                })
                    .subscribe(function (targets) {
                    console.log(targets);
                }, function (e) {
                    console.error(e);
                });
            });
            describeCommand("report", function () {
                var assets = getAssets();
                var targets = readTargets();
                var assignments = readAssignments();
                rxts_1.Observable.zip3(targets, assignments, assets)
                    .map(function (zip) {
                    return new Progress(zip[0], zip[1], zip[2]);
                })
                    .subscribe(function (result) {
                    console.log(result);
                }, function (e) {
                    if (e instanceof UnassignedAssetError) {
                        console.error("Unassigned asset " + e.assetId + ", call assignment");
                    }
                    else {
                        console.error(e);
                    }
                }, function () {
                });
            });
        });
    }
    main();
});
//# sourceMappingURL=etcl.js.map