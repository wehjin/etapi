/**
 * @author  wehjin
 * @since   8/27/15
 */

///<reference path="node_modules/rxts/rxts.d.ts"/>
///<reference path="./typings/node/node.d.ts" />
///<reference path="./typings/open/open.d.ts" />
///<reference path="./typings/prompt/prompt.d.ts" />


import {Http,Observable,Subscriber,BooleanSubscription} from "rxts";
import {Service, OauthRequestToken, Credentials, AccessToken} from "et";
import fs = require("fs");
import open = require("open");
import prompt = require("prompt");

function readSetup(filepath : string) : Observable<Object> {
    return Observable.create((subscriber : Subscriber<string>)=> {
        fs.readFile(filepath, function (err, data) {
            if (err) {
                subscriber.onError(err);
                return;
            }
            subscriber.onNext(data.toString('utf8'));
            subscriber.onCompleted();
        });
    }).map((s : string)=> {
        return JSON.parse(s);
    });
}

function getAccessCredential(requestToken : OauthRequestToken) : Observable<Credentials> {

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

var setup = readSetup(process.env['HOME'] + '/.etcl/setup.json');
var buildService = setup.map((setup : Object) : Service => {
    return new Service(setup);
});
var fetchRequestToken = buildService.flatMap((service : Service) : Observable<OauthRequestToken>=> {
    return service.fetchRequestToken();
});
fetchRequestToken
    .flatMap((requestToken : OauthRequestToken)=> {
        return getAccessCredential(requestToken);
    })
    .flatMap((credentials : Credentials)=> {
        return credentials.getAccessToken();
    })
    .flatMap((accessToken : AccessToken)=> {
        return accessToken.getAccountList();
    })
    .subscribe((result)=> {
        console.log(result);
    }, (e)=> {
        console.error(e);
    });
