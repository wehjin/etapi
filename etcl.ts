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

class NoEntryError implements Error {
    name : string = "NoEntryError";
    message : string;

    constructor(message : string) {
        this.message = message;
    }
}

function readJson(filepath : string) : Observable<Object> {
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
    }

    private addPosition(position : Object) {
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
        return report;
    }
}

function main() {
    var accessToken = readJson(setupPath)
        .map((setup : Object) : Service => {
            return new Service(setup);
        })
        .flatMap((service : Service) : Observable<AccessToken>=> {
            return readOrFetchAccessToken(service);
        });

    readOrFetchAccountList(accessToken)
        .map((accountList)=> {
            return new Assets(accountList);
        })
        .map((assets)=> {
            return assets.report();
        })
        .subscribe((result)=> {
            console.log(result);
        }, (e)=> {
            console.error(e);
        }, ()=> {
        });
}
main();