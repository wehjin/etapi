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
})(["require", "exports", "rxts", "et", "fs", "./etcl-human"], function (require, exports) {
    ///<reference path="node_modules/rxts/rxts.d.ts"/>
    ///<reference path="./typings/node/node.d.ts" />
    ///<reference path="./typings/open/open.d.ts" />
    ///<reference path="./typings/prompt/prompt.d.ts" />
    var rxts_1 = require("rxts");
    var et_1 = require("et");
    var fs = require("fs");
    var human = require("./etcl-human");
    var homePath = process.env['HOME'];
    var prefPath = homePath + '/.etcl';
    var setupPath = prefPath + '/setup.json';
    var accessTokenPath = prefPath + "/accessToken.json";
    var accountListPath = prefPath + "/accountList.json";
    var targetsPath = prefPath + "/targets.json";
    var assignmentsPath = prefPath + "/assignments.json";
    var unassignedAssetIdSeparator = ":";
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
    function fetchAccessToken(service) {
        return service.fetchRequestToken()
            .flatMap(function (requestToken) {
            return human.askForVerifier(requestToken.getAuthenticationUrl())
                .map(function (verifier) {
                return new et_1.Credentials(verifier, requestToken);
            });
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
        function UnassignedAssetError(assets) {
            this.assets = assets;
            this.name = "UnassignedAssetError";
            this.unassignedAssetIds = [];
            for (var i = 0; i < assets.length; i++) {
                var asset = assets[i];
                this.unassignedAssetIds.push(asset.symbol + unassignedAssetIdSeparator +
                    asset.typeCode);
            }
            this.message = "No or invalid target for assets: " + this.unassignedAssetIds;
        }
        return UnassignedAssetError;
    })();
    function scoreMarketValue(score) {
        var marketValue = 0.0;
        var assets = score.assets;
        for (var j = 0; j < assets.length; j++) {
            var asset = assets[j];
            marketValue += asset.marketValue;
        }
        return marketValue;
    }
    function scoreProportionOfPortfolio(score, portfolioMarketValue) {
        return scoreMarketValue(score) / portfolioMarketValue;
    }
    var Progress = (function () {
        function Progress(targets, assignments, assets) {
            this.scoresByTargetId = {};
            this.scores = [];
            for (var i = 0; i < targets.length; i++) {
                var target = targets[i];
                var score = {
                    target: target,
                    assets: []
                };
                this.scoresByTargetId[target.targetId] = score;
                this.scores.push(score);
            }
            var assetList = assets.getAssetList();
            var unassignedAssetsList = [];
            for (var i = 0; i < assetList.length; i++) {
                var asset = assetList[i];
                var assetId = asset.assetId;
                var targetId = assignments[assetId];
                if (!targetId) {
                    unassignedAssetsList.push(asset);
                    continue;
                }
                var score = this.scoresByTargetId[targetId];
                if (!score) {
                    unassignedAssetsList.push(asset);
                    continue;
                }
                score.assets.push(asset);
            }
            if (unassignedAssetsList.length > 0) {
                throw new UnassignedAssetError(unassignedAssetsList);
            }
        }
        Progress.prototype.portfolioMarketValue = function () {
            var marketValue = 0.0;
            for (var i = 0; i < this.scores.length; i++) {
                var score = this.scores[i];
                marketValue += scoreMarketValue(score);
            }
            return marketValue;
        };
        Progress.prototype.report = function () {
            var fullReport = "";
            var portfolioMarketValue = this.portfolioMarketValue();
            for (var i = 0; i < this.scores.length; i++) {
                var score = this.scores[i];
                var scoreProportion = scoreProportionOfPortfolio(score, portfolioMarketValue);
                var targetProportion = score.target.fraction;
                var error = scoreProportion - targetProportion;
                var errorRatio = error / targetProportion;
                var scoreReport = score.target.targetId + " : " +
                    ((errorRatio >= 0) ? "overweight " : "underweight ") +
                    (errorRatio * 100).toFixed(2) + "%\n";
                fullReport += scoreReport;
            }
            return fullReport;
        };
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
        });
    }
    function readTargetIds() {
        return readTargets()
            .map(function (targets) {
            var targetIds = [];
            for (var i = 0; i < targets.length; i++) {
                targetIds.push(targets[i].targetId);
            }
            return targetIds;
        });
    }
    function readAssignments() {
        return readJson(assignmentsPath)
            .onErrorResumeNext(function (e) {
            return (e instanceof NoEntryError) ? rxts_1.Observable.from([{}]) : rxts_1.Observable.error(e);
        });
    }
    function writeAssignments(newAssignments) {
        return readAssignments()
            .map(function (existingAssignments) {
            for (var unassignedAssetId in newAssignments) {
                var symbolAndTypeCode = unassignedAssetId.split(unassignedAssetIdSeparator);
                var assetId = Assets.getAssetId(symbolAndTypeCode[0], symbolAndTypeCode[1]);
                existingAssignments[assetId] = newAssignments[unassignedAssetId];
            }
            return existingAssignments;
        })
            .flatMap(function (assignments) {
            return saveAny(assignments, assignmentsPath);
        });
    }
    function formatTarget(target) {
        return target.targetId + ": " + target.fraction.toFixed(3);
    }
    function formatTargets(targets) {
        var fullFormat = "";
        for (var i = 0; i < targets.length; i++) {
            fullFormat += (i + 1).toString() + ". " + formatTarget(targets[i]) + "\n";
        }
        return fullFormat;
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
    function getFormattedTargets() {
        return readTargets()
            .map(function (targets) {
            return formatTargets(targets);
        });
    }
    function addNewTarget() {
        return readTargetIds()
            .flatMap(function (targetIds) {
            return human.askForNewTarget(targetIds);
        })
            .flatMap(function (newTarget) {
            return readTargets()
                .map(function (targets) {
                targets.splice(newTarget[0], 0, {
                    targetId: newTarget[1],
                    fraction: newTarget[2]
                });
                return targets;
            });
        })
            .flatMap(function (targets) {
            return saveAny(targets, targetsPath);
        });
    }
    function main() {
        describeProgram("etcl", function () {
            describeCommand("assignment", function () {
                var symbolAndTypeCode = "GOOG:EQ";
                var targetId = "stocks";
                describeArgument("assetId", symbolAndTypeCode, function (arg) {
                    symbolAndTypeCode = arg;
                });
                describeArgument("targetId", targetId, function (arg) {
                    targetId = arg;
                });
                var assignments = {};
                assignments[symbolAndTypeCode] = targetId;
                writeAssignments(assignments)
                    .subscribe(function (assignments) {
                    console.log(assignments);
                }, function (e) {
                    console.error(e);
                });
            });
            describeCommand("segments", function () {
                var getSegmentCommand = human.askForTargetOperation(getFormattedTargets());
                var getSegmentCommandsUntilDone = getSegmentCommand.flatMap(function (command) {
                    if (command === "=") {
                        return rxts_1.Observable.from(["done"]);
                    }
                    else if (command === "+") {
                        return addNewTarget()
                            .flatMap(function (targets) {
                            return getSegmentCommandsUntilDone;
                        });
                    }
                    else {
                        return getSegmentCommandsUntilDone;
                    }
                });
                getSegmentCommandsUntilDone.subscribe(console.log, console.error);
            });
            describeCommand("setTarget", function () {
                var targetName;
                var targetFraction;
                describeArgument("targetId", "stocks", function (arg) {
                    targetName = arg;
                });
                describeArgument("fraction", ".7", function (arg) {
                    targetFraction = parseFloat(arg);
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
                var progress = rxts_1.Observable.zip3(readTargets(), readAssignments(), getAssets())
                    .map(function (zip) {
                    return new Progress(zip[0], zip[1], zip[2]);
                });
                progress.onErrorResumeNext(function (e) {
                    if (e instanceof UnassignedAssetError) {
                        var unassignedAssetIds = e.unassignedAssetIds;
                        console.log("Unassigned assets: ", unassignedAssetIds);
                        return readTargetIds()
                            .flatMap(function (targetIds) {
                            return human.askForAssignments(unassignedAssetIds, targetIds);
                        })
                            .flatMap(function (assignments) {
                            return writeAssignments(assignments);
                        })
                            .flatMap(function (assignments) {
                            return progress;
                        });
                    }
                    else {
                        return rxts_1.Observable.error(e);
                    }
                }).subscribe(function (result) {
                    console.log(result.report());
                }, console.error);
            });
        });
    }
    main();
});
//# sourceMappingURL=etcl.js.map