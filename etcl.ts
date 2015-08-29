/**
 * @author  wehjin
 * @since   8/27/15
 */

///<reference path="node_modules/rxts/rxts.d.ts"/>
///<reference path="./typings/node/node.d.ts" />
///<reference path="./typings/open/open.d.ts" />
///<reference path="./typings/prompt/prompt.d.ts" />


import {Http,Observable,Subscriber,BooleanSubscription} from "rxts";
import {Service, OauthRequestToken, Credentials, AccessToken, TokenExpiredError, AccountList} from "et";
import fs = require("fs");
import open = require("open");
import prompt = require("prompt");

var homePath = process.env['HOME'];
var prefPath = homePath + '/.etcl';
var setupPath = prefPath + '/setup.json';
var accessTokenPath = prefPath + "/accessToken.json";

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

function deleteAccessToken() : Observable<boolean> {
    return Observable.create((subscriber : Subscriber<boolean>)=> {
        var subscription = new BooleanSubscription();
        fs.unlink(accessTokenPath, (err : any)=> {
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

function saveAccessToken(accessToken : AccessToken) : Observable<AccessToken> {
    return Observable.create((subscriber : Subscriber<AccessToken>)=> {
        var subscription = new BooleanSubscription();
        var saveJson = JSON.stringify({
            token: accessToken.token,
            secret: accessToken.secret,
            flags: accessToken.flags
        });
        fs.writeFile(accessTokenPath, saveJson, {
            mode: 0600
        }, (err : any)=> {
            if (subscription.isUnsubscribed()) {
                return;
            }
            if (err) {
                subscriber.onError(err);
                return;
            }
            subscriber.onNext(accessToken);
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

function fetchAccessToken(service : Service) {
    return service.fetchRequestToken()
        .flatMap((requestToken : OauthRequestToken)=> {
            return askHumanForAccessCredentials(requestToken);
        })
        .flatMap((credentials : Credentials)=> {
            return credentials.getAccessToken();
        })
        .flatMap((accessToken : AccessToken) : Observable<AccessToken>=> {
            return saveAccessToken(accessToken);
        });
}

function readOrFetchAccessToken(service : Service) : Observable<AccessToken> {
    return readJson(accessTokenPath)
        .map((json : Object)=> {
            return new AccessToken(json['token'], json['secret'], json['flags'], service);
        })
        .onErrorResumeNext((e)=> {
            if (e instanceof NoEntryError) {
                return fetchAccessToken(service);
            } else {
                return Observable.error(e);
            }
        });
}

var setup = readJson(setupPath);
var loadService = setup.map((setup : Object) : Service => {
    return new Service(setup);
});
var getAccountList = loadService
    .flatMap((service : Service) : Observable<AccessToken>=> {
        return readOrFetchAccessToken(service);
    })
    .flatMap((accessToken : AccessToken)=> {
        return accessToken.getAccountList();
    });
getAccountList
    .onErrorResumeNext((e)=> {
        if (e instanceof TokenExpiredError) {
            return deleteAccessToken().flatMap(()=> {
                return getAccountList;
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
    .subscribe((result)=> {
        console.log(result);
    }, (e)=> {
        console.error(e);
    });
