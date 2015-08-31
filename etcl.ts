/**
 * @author  wehjin
 * @since   8/27/15
 */

///<reference path="node_modules/rxts/rxts.d.ts"/>
///<reference path="./typings/node/node.d.ts" />
///<reference path="./typings/open/open.d.ts" />
///<reference path="./typings/prompt/prompt.d.ts" />


import {Http,Observable,Subscriber,BooleanSubscription} from "rxts";
import {Service, OauthRequestToken, Credentials, AccessToken, TokenError, AccountList,Jsonable} from "et";
import fs = require("fs");
import open = require("open");
import prompt = require("prompt");

var homePath = process.env['HOME'];
var prefPath = homePath + '/.etcl';
var setupPath = prefPath + '/setup.json';
var accessTokenPath = prefPath + "/accessToken.json";
var accountListPath = prefPath + "/accountList.json";
var targetsPath = prefPath + "/targets.json";
var assignmentsPath = prefPath + "/assignments.json";
var accountIdSeparator = ":";

class NoEntryError implements Error {
    name : string = "NoEntryError";
    message : string;

    constructor(message : string) {
        this.message = message;
    }
}

function readJson(filepath : string) : Observable<any> {
    return Observable.create((subscriber : Subscriber<string>)=> {
        fs.readFile(filepath, function (err, data) {
            if (err) {
                if (err['code'] === 'ENOENT') {
                    subscriber.onError(new NoEntryError(JSON.stringify(err)));
                } else {
                    subscriber.onError(err);
                }
                return;
            }
            subscriber.onNext(data.toString('utf8'));
            subscriber.onCompleted();
        });
    }).map((s : string)=> {
        return JSON.parse(s);
    });
}

function saveAny<T>(toSave : T, filePath : string) : Observable<T> {
    return Observable.create((subscriber : Subscriber<Object>)=> {
        var subscription = new BooleanSubscription();
        fs.writeFile(filePath, JSON.stringify(toSave), {
            mode: 0600
        }, (err : any)=> {
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

function saveJson<T extends Jsonable>(jsonable : T, filePath : string) : Observable<T> {
    return Observable.create((subscriber : Subscriber<Object>)=> {
        var subscription = new BooleanSubscription();
        fs.writeFile(filePath, jsonable.toJson(), {
            mode: 0600
        }, (err : any)=> {
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
    return Observable.create((subscriber : Subscriber<boolean>)=> {
        var subscription = new BooleanSubscription();
        fs.unlink(path, (err : any)=> {
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

function askHumanForAccessCredentials(requestToken : OauthRequestToken) : Observable<Credentials> {

    return Observable.create((subscriber : Subscriber<Credentials>)=> {
        var subscription = new BooleanSubscription();
        open(requestToken.getAuthenticationUrl());
        prompt.start();
        prompt.get(['verifier'], function (err, result) {
            if (subscriber.isUnsubscribed()) {
                return;
            }
            if (err) {
                subscriber.onError(err);
            } else {
                var verifier = result['verifier'].trim();
                if (verifier.length === 0) {
                    subscriber.onError(new Error("no verifier"));
                    return;
                }
                subscriber.onNext(new Credentials(verifier, requestToken));
                subscriber.onCompleted();
            }
        });
        return subscription;
    });
}

function fetchAccessToken(service : Service) : Observable<AccessToken> {
    return service.fetchRequestToken()
        .flatMap((requestToken : OauthRequestToken)=> {
            return askHumanForAccessCredentials(requestToken);
        })
        .flatMap((credentials : Credentials)=> {
            return credentials.getAccessToken();
        })
        .flatMap((accessToken : AccessToken) : Observable<AccessToken>=> {
            return saveJson(accessToken, accessTokenPath);
        });
}

function readAccessToken(service : Service) : Observable<AccessToken> {
    return readJson(accessTokenPath)
        .map((json : Object)=> {
            return new AccessToken(json['token'], json['secret'], json['flags'], service);
        });
}

function readOrFetchAccessToken(service : Service) : Observable<AccessToken> {
    return readAccessToken(service)
        .onErrorResumeNext((e)=> {
            if (e instanceof NoEntryError) {
                return fetchAccessToken(service);
            } else {
                return Observable.error(e);
            }
        });
}

function fetchAccountList(accessToken : Observable<AccessToken>) : Observable<AccountList> {
    var fetchBaseAccountList = accessToken
        .flatMap((accessToken : AccessToken)=> {
            return accessToken.fetchAccountList();
        });
    return fetchBaseAccountList
        .onErrorResumeNext((e)=> {
            if (e instanceof TokenError) {
                return deleteJson(accessTokenPath).flatMap(()=> {
                    return fetchBaseAccountList;
                })
            } else {
                return Observable.error(e);
            }
        })
        .flatMap((accountList : AccountList)=> {
            return accountList.refreshBalances();
        })
        .flatMap((accountList : AccountList)=> {
            return accountList.refreshPositions();
        })
        .flatMap((accountList : AccountList)=> {
            return saveJson(accountList, accountListPath)
        });
}

function readAccountList(accessToken : Observable<AccessToken>) : Observable<AccountList> {
    return accessToken
        .flatMap((accessToken : AccessToken)=> {
            return readJson(accountListPath)
                .map((jsonAccountList : Object)=> {
                    return AccountList.fromJson(jsonAccountList, accessToken);
                });
        });
}

function readOrFetchAccountList(accessToken : Observable<AccessToken>) : Observable<AccountList> {
    return readAccountList(accessToken)
        .onErrorResumeNext((e)=> {
            if (e instanceof NoEntryError) {
                return fetchAccountList(accessToken);
            } else {
                return Observable.error(e);
            }
        });
}

class Asset {
    assetId : string;
    positions : Object[] = [];
    symbol : string;
    typeCode : string;
    quantity : number = 0;
    marketValue : number = 0;
    currentPrice : number = 0;
    descriptions : string[] = [];

    constructor(assetId : string, symbol : string, typeCode : string) {
        this.assetId = assetId;
        this.symbol = symbol;
        this.typeCode = typeCode;
    }

    addPosition(position : Object) : void {
        this.positions.push(position);
        this.quantity += parseFloat(position['qty']);
        this.marketValue += parseFloat(position['marketValue']);
        this.currentPrice = parseFloat(position['currentPrice']);
        this.descriptions.push(position['description']);
    }

    report() : string {
        return this.symbol + ":" + this.typeCode + ": $ " + this.marketValue.toFixed(2) + "\n";
    }
}

interface AssetMap {
    [index:string]:Asset;
}
class Assets {
    assets : AssetMap = {};
    private accountList;

    constructor(accountList : AccountList) {
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

    static getAssetId(symbol : string, typeCode : string) : string {
        return JSON.stringify({
            symbol: symbol,
            typeCode: typeCode
        });
    }

    getAssetList() : Asset[] {
        var assets = [];
        for (var key in this.assets) {
            assets.push(this.assets[key]);
        }
        return assets;
    }

    private addPosition(position : Object) {
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
    }

    report() {
        var report = '';
        var array : Asset[] = [];
        for (var assetId in this.assets) {
            array.push(this.assets[assetId]);
        }
        array.sort((a : Asset, b : Asset)=> {
            return a.symbol.localeCompare(b.symbol);
        });
        for (var i = 0; i < array.length; i++) {
            var asset = array[i];
            report += asset.report();
        }
        report += ":: " + this.accountList.date;
        return report;
    }
}

class UnassignedAssetError implements Error {
    name : string = "UnassignedAssetError";
    message : string;
    assetId : string;

    constructor(private asset : Asset) {
        this.assetId = asset.symbol + accountIdSeparator + asset.typeCode;
        this.message = "No or invalid target for asset: " + this.assetId;
    }
}

interface Target {
    targetId : string;
    fraction : number;
}

interface Score {
    target : Target;
    assets : Asset[];
}

class Progress {
    scores : { [targetId:string]:Score } = {};

    constructor(targets : Target[], assignments : Object, assets : Assets) {
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
}

function getAssets() : Observable<Assets> {
    var accessToken = readJson(setupPath)
        .map((setup : Object) : Service => {
            return new Service(setup);
        })
        .flatMap((service : Service) : Observable<AccessToken>=> {
            return readOrFetchAccessToken(service);
        });
    return readOrFetchAccountList(accessToken)
        .map((accountList)=> {
            return new Assets(accountList);
        });
}

function readTargets() : Observable<Target[]> {
    return readJson(targetsPath)
        .map((json) : Target[]=> {
            return json;
        })
        .onErrorResumeNext((e)=> {
            return Observable.error(new Error("No targets - call setTarget"));
        })
}

function readAssignments() : Observable<Object> {
    return readJson(assignmentsPath)
        .onErrorResumeNext((e)=> {
            return (e instanceof NoEntryError) ? Observable.from([{}]) : Observable.error(e);
        });
}

var argIndex = 2;
var commands = [];
var currentCommand : string;
var allArguments = {};
function describeCommand(name : string, f : ()=>void) {
    commands.push(name);
    if (process.argv[argIndex] == name) {
        argIndex++;
        currentCommand = name;
        allArguments[currentCommand] = [];
        f();
    }
}

function describeArgument(name : string, example : any, f : (arg)=>void) {
    allArguments[currentCommand].push([name, example]);
    if (argIndex === process.argv.length) {
        throw "missing argument";
    }
    var arg = (typeof example === 'number') ?
        parseFloat(process.argv[argIndex++]) :
        process.argv[argIndex++];
    f(arg);
}

function describeProgram(name : string, f : ()=>void) {
    try {
        f();
    } catch (e) {
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
    describeProgram("etcl", ()=> {
        describeCommand("assignment", ()=> {
            var assetId;
            var targetId;
            describeArgument("assetId", "GOOG|EQ", (arg)=> {
                var symbolAndTypeCode = arg.split(accountIdSeparator);
                assetId = Assets.getAssetId(symbolAndTypeCode[0], symbolAndTypeCode[1]);
            });
            describeArgument("targetId", "stocks", (arg)=> {
                targetId = arg;
            });
            readAssignments()
                .map((assignments)=> {
                    assignments[assetId] = targetId;
                    return assignments;
                })
                .flatMap((assignments) => {
                    return saveAny(assignments, assignmentsPath);
                })
                .subscribe((assignments)=> {
                    console.log(assignments);
                }, (e)=> {
                    console.error(e);
                });
        });

        describeCommand("setTarget", ()=> {
            var targetName;
            var targetFraction;
            describeArgument("targetId", "stocks", (arg)=> {
                targetName = arg;
            });
            describeArgument("fraction", ".7", (arg)=> {
                targetFraction = arg;
            });
            readTargets()
                .onErrorResumeNext((e)=> {
                    return Observable.from([[]]);
                })
                .map((targets : Target[])=> {
                    targets.push({
                        targetId: targetName,
                        fraction: targetFraction,
                    });
                    return targets;
                })
                .flatMap((targets : Target[])=> {
                    return saveAny(targets, targetsPath);
                })
                .subscribe((targets)=> {
                    console.log(targets);
                }, (e)=> {
                    console.error(e);
                });
        });
        describeCommand("report", ()=> {
            var assets = getAssets();
            var targets = readTargets();
            var assignments = readAssignments();
            Observable.zip3(targets, assignments, assets)
                .map((zip : [Target[],Object,Assets]) : Progress=> {
                    return new Progress(zip[0], zip[1], zip[2]);
                })
                .subscribe((result)=> {
                    console.log(result);
                }, (e)=> {
                    if (e instanceof UnassignedAssetError) {
                        console.error("Unassigned asset " + e.assetId + ", call assignment");
                    } else {
                        console.error(e);
                    }
                }, ()=> {
                });
        });
    });
}
main();