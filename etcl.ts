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
import human = require("./etcl-human");
import * as data from "./etcl-data";

var homePath = process.env['HOME'];
var prefPath = homePath + '/.etcl';
var setupPath = prefPath + '/setup.json';
var accessTokenPath = prefPath + "/accessToken.json";
var accountListPath = prefPath + "/accountList.json";
var targetsPath = prefPath + "/targets.json";
var assignmentsPath = prefPath + "/assignments.json";
var assetDisplayIdSeparator = ":";

function getService() : Observable<Service> {
    return data.readJson(setupPath)
        .map((setup : Object) : Service => {
            return new Service(setup);
        });
}

function fetchAccessToken(service : Service) : Observable<AccessToken> {
    return service.fetchRequestToken()
        .flatMap((requestToken : OauthRequestToken)=> {
            return human.askForVerifier(requestToken.getAuthenticationUrl())
                .map((verifier : string)=> {
                    return new Credentials(verifier, requestToken);
                });
        })
        .flatMap((credentials : Credentials)=> {
            return credentials.getAccessToken();
        })
        .flatMap((accessToken : AccessToken) : Observable<AccessToken>=> {
            return data.saveJson(accessToken, accessTokenPath);
        });
}

function readOrFetchAccessToken(service : Service) : Observable<AccessToken> {
    return data.readJson(accessTokenPath)
        .map((json : Object)=> {
            return new AccessToken(json['token'], json['secret'], json['flags'], service);
        })
        .onErrorResumeNext((e)=> {
            if (e instanceof data.NoEntryError) {
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
                return data.deleteJson(accessTokenPath).flatMap(()=> {
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
            return data.saveJson(accountList, accountListPath)
        });
}

function readOrFetchAccountList(accessToken : Observable<AccessToken>) : Observable<AccountList> {
    return accessToken
        .flatMap((accessToken : AccessToken)=> {
            return data.readJson(accountListPath)
                .map((jsonAccountList : Object)=> {
                    return AccountList.fromJson(jsonAccountList, accessToken);
                });
        })
        .onErrorResumeNext((e)=> {
            if (e instanceof data.NoEntryError) {
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

    static getAssetDisplayId(assetId : string) {
        var json = JSON.parse(assetId);
        return json.symbol + assetDisplayIdSeparator + json.typeCode;
    }

    static getAssetListFromAssets(assets : Assets) : Asset[] {
        var assetList : Asset[] = [];
        var assetsMap = assets.assets;
        for (var assetId in assetsMap) {
            if (assetsMap.hasOwnProperty(assetId)) {
                assetList.push(assetsMap[assetId]);
            }
        }
        return assetList;
    }

    static fromAssetsToAssetList(assets : Assets) : Observable<Asset[]> {
        return Observable.from([Assets.getAssetListFromAssets(assets)]);
    }

    getAssetList() : Asset[] {
        return Assets.getAssetListFromAssets(this);
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
    unassignedAssetIds : string[] = [];

    constructor(private assets : Asset[]) {
        for (var i = 0; i < assets.length; i++) {
            var asset = assets[i];
            var assetDisplayId = asset.symbol + assetDisplayIdSeparator + asset.typeCode;
            this.unassignedAssetIds.push(assetDisplayId);
        }
        this.message = "No or invalid target for assets: " + this.unassignedAssetIds;
    }
}

interface Target {
    targetId : string;
    fraction : number;
}

interface Segment {
    target : Target;
    assets : Asset[];
}

function scoreMarketValue(score : Segment) {
    var marketValue = 0.0;
    var assets = score.assets;
    for (var j = 0; j < assets.length; j++) {
        var asset = assets[j];
        marketValue += asset.marketValue;
    }
    return marketValue;
}

function scoreProportionOfPortfolio(score : Segment, portfolioMarketValue : number) : number {
    return scoreMarketValue(score) / portfolioMarketValue;
}

class Progress {
    scoresByTargetId : { [targetId:string]:Segment } = {};
    scores : Segment[] = [];

    constructor(targets : Target[], assignments : Object, assets : Assets) {
        for (var i = 0; i < targets.length; i++) {
            var target = targets[i];
            var score : Segment = {
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

    portfolioMarketValue() : number {
        var marketValue = 0.0;
        for (var i = 0; i < this.scores.length; i++) {
            var score = this.scores[i];
            marketValue += scoreMarketValue(score);
        }
        return marketValue;
    }

    report() : string {
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
    }
}

function getAssets() : Observable<Assets> {
    var accessToken = getService()
        .flatMap((service : Service) : Observable<AccessToken>=> {
            return readOrFetchAccessToken(service);
        });
    return readOrFetchAccountList(accessToken)
        .map((accountList)=> {
            return new Assets(accountList);
        });
}

function readTargets() : Observable<Target[]> {
    return data.readJson(targetsPath)
        .map((json) : Target[]=> {
            return json;
        });
}

function readTargetIds() : Observable<string[]> {
    return readTargets()
        .map((targets : Target[])=> {
            var targetIds : string[] = [];
            for (var i = 0; i < targets.length; i++) {
                targetIds.push(targets[i].targetId);
            }
            return targetIds;
        });
}

function readAssignments() : Observable<Object> {
    return data.readJson(assignmentsPath)
        .onErrorResumeNext((e)=> {
            return (e instanceof data.NoEntryError) ? Observable.from([{}]) : Observable.error(e);
        });
}

function writeAssignments(newAssignments : {[unassigendAssetId:string]:string}) : Observable<Object> {
    return readAssignments()
        .map((existingAssignments)=> {
            for (var unassignedAssetId in newAssignments) {
                var symbolAndTypeCode = unassignedAssetId.split(assetDisplayIdSeparator);
                var assetId = Assets.getAssetId(symbolAndTypeCode[0], symbolAndTypeCode[1]);
                existingAssignments[assetId] = newAssignments[unassignedAssetId];
            }
            return existingAssignments;
        })
        .flatMap((assignments) => {
            return data.saveAny(assignments, assignmentsPath);
        });
}

function formatTarget(target : Target) : string {
    return target.targetId + ": " + target.fraction.toFixed(3);
}

function formatTargets(targets : Target[]) : string {
    var fullFormat = "";
    for (var i = 0; i < targets.length; i++) {
        fullFormat += (i + 1).toString() + ". " + formatTarget(targets[i]) + "\n";
    }
    return fullFormat;
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

function getFormattedTargets() : Observable<string> {
    return readTargets()
        .map((targets : Target[]) : string=> {
            return formatTargets(targets);
        });
}

function deleteOldTarget() : Observable<Target[]> {
    return readTargetIds()
        .flatMap(human.askForPositionInArray)
        .flatMap((oldTarget : number)=> {
            return readTargets()
                .map((targets : Target[])=> {
                    if (targets.length > 0) {
                        targets.splice(oldTarget, 1);
                    }
                    return targets;
                });
        })
        .flatMap((targets : Target[])=> {
            return data.saveAny(targets, targetsPath);
        });
}

function addNewTarget() : Observable<Target[]> {
    return readTargetIds()
        .flatMap((targetIds : string[])=> {
            return human.askForNewTarget(targetIds);
        })
        .flatMap((newTarget : [number,string,number])=> {
            return readTargets()
                .map((targets : Target[])=> {
                    targets.splice(newTarget[0], 0, {
                        targetId: newTarget[1],
                        fraction: newTarget[2]
                    });
                    return targets;
                });
        })
        .flatMap((targets : Target[])=> {
            return data.saveAny(targets, targetsPath);
        });
}

interface Assignment {
    assetId:string,
    segmentId:string
}

function formatAssignments(assignments : Assignment[]) {
    var lines : string = "";
    for (var i = 0; i < assignments.length; i++) {
        if (i > 0) {
            lines += "\n";
        }
        var assignment = assignments[i];
        var assetDisplayId = Assets.getAssetDisplayId(assignment.assetId);
        lines += (i + 1).toString() + ". " + assetDisplayId + " - " + assignment.segmentId;
    }
    return lines;
}

function getAssignmentList() : Observable<Assignment[]> {
    return readAssignments()
        .map((assignments : Object)=> {
            var list : Assignment[] = [];
            for (var assetId in assignments) {
                if (assignments.hasOwnProperty(assetId)) {
                    list.push({
                        assetId: assetId,
                        segmentId: assignments[assetId]
                    });
                }
            }
            return list;
        });
}

function getFormattedAssignments() : Observable<string> {
    return getAssignmentList()
        .map((list : Assignment[])=> {
            return formatAssignments(list);
        });
}

function fromAssetToAssetDisplay(asset : Asset) : string {
    return Assets.getAssetDisplayId(asset.assetId) + "  $ " + asset.marketValue.toFixed(2);
}

var getAccountList = function () {
    return getService().flatMap((service : Service)=> {
        return readOrFetchAccountList(readOrFetchAccessToken(service));
    });
};

function main() {
    describeProgram("etcl", ()=> {

        describeCommand("assets", ()=> {
            getAssets()
                .flatMap(Assets.fromAssetsToAssetList)
                .flatMap(Observable.from)
                .map(fromAssetToAssetDisplay)
                .endWith("")
                .subscribe(console.log, console.error);
        });

        describeCommand("accounts", ()=> {
            getAccountList().subscribe(console.log, console.error);
        });

        describeCommand("net", ()=> {
            getAccountList().map((accountList : Object)=> {
                var accumulated : number = 0;
                accountList["accounts"].forEach((account : Object)=> {
                    var more = parseFloat(account["netAccountValue"]);
                    accumulated += more;
                });
                return accumulated;
            }).subscribe(console.log, console.error);
        });

        describeCommand("assignments", ()=> {
            var editAssignments = human.askForAddSubtractDoneCommand(getFormattedAssignments())
                .flatMap((command : string)=> {
                    if (command === "=") {
                        return Observable.from(["done"]);
                    } else if (command === "-") {
                        return getAssignmentList()
                            .flatMap(human.askForPositionInArray)
                            .flatMap((index : number)=> {
                                return getAssignmentList()
                                    .map((assignments : Assignment[])=> {
                                        if (assignments.length > 0) {
                                            assignments.splice(index, 1);
                                        }
                                        return assignments;
                                    });
                            })
                            .flatMap((assignments : Assignment[])=> {
                                var object = {};
                                for (var i = 0; i < assignments.length; i++) {
                                    var assignment = assignments[i];
                                    object[assignment.assetId] = assignment.segmentId;
                                }
                                return data.saveAny(object, assignmentsPath);
                            })
                            .flatMap(()=> {
                                return editAssignments;
                            });
                    } else {
                        console.error(command + " not supported");
                        return editAssignments;
                    }
                });
            editAssignments
                .subscribe(console.log, console.error);
        });

        describeCommand("segments", ()=> {
            var editSegments = human
                .askForAddSubtractDoneCommand(getFormattedTargets())
                .flatMap((command : string)=> {
                    if (command === "=") {
                        return Observable.from(["done"]);
                    } else if (command === "+") {
                        return addNewTarget()
                            .flatMap(()=> {
                                return editSegments;
                            });
                    } else if (command === "-") {
                        return deleteOldTarget()
                            .flatMap(()=> {
                                return editSegments;
                            });
                    } else {
                        return editSegments;
                    }
                });
            editSegments.subscribe(console.log, console.error);
        });

        describeCommand("report", ()=> {
            var progress = Observable.zip3(readTargets(), readAssignments(), getAssets())
                .map((zip : [Target[],Object,Assets]) : Progress=> {
                    return new Progress(zip[0], zip[1], zip[2]);
                });
            progress.onErrorResumeNext((e)=> {
                if (e instanceof UnassignedAssetError) {
                    var unassignedAssetIds : string[] = e.unassignedAssetIds;
                    console.log("Unassigned assets: ", unassignedAssetIds);
                    return readTargetIds()
                        .flatMap((targetIds)=> {
                            return human.askForAssignments(unassignedAssetIds, targetIds);
                        })
                        .flatMap((assignments : {[unassigendAssetId:string]:string})=> {
                            return writeAssignments(assignments);
                        })
                        .flatMap(()=> {
                            return progress;
                        });
                } else {
                    return Observable.error(e);
                }
            }).subscribe((result)=> {
                console.log(result.report());
            }, console.error);
        });
    });
}
main();