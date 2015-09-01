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
import open = require("open");
import prompt = require("prompt");

export interface UnassignedAssetsMap {
    [unassigendAssetId:string]:string
}

export function askForAssignments(unassignedAssetIds : string[],
                                  targetIds : string[]) : Observable<UnassignedAssetsMap> {
    var chain : Observable<UnassignedAssetsMap>;
    for (var i = 0; i < unassignedAssetIds.length; i++) {
        if (!chain) {
            chain = askForAssignment({}, unassignedAssetIds[0], targetIds);
            continue;
        }
        function chainAsk(chainIndex : number) : (newAssignments : UnassignedAssetsMap)=> Observable<UnassignedAssetsMap> {
            return (newAssignments : UnassignedAssetsMap)=> {
                var unassignedAssetId = unassignedAssetIds[chainIndex];
                return askForAssignment(newAssignments, unassignedAssetId, targetIds);
            }
        }

        chain = chain.flatMap(chainAsk(i));
    }
    return chain;
}

function askForAssignment(newAssignments : UnassignedAssetsMap, unassignedAssetId : string,
                          targetIds : string[]) : Observable<UnassignedAssetsMap> {
    return Observable.create((subscriber : Subscriber<string>)=> {
        var description = "Allocation for " + unassignedAssetId + "\nChoices";
        for (var i = 0; i < targetIds.length; i++) {
            description += "\n  " + (i + 1) + ". " + targetIds[i];
        }
        description += "\nSelect";
        prompt.start();
        prompt.get({
            properties: {
                selection: {
                    description: description,
                    type: 'number',
                    'default': 1,
                    required: true,
                    pattern: /^\d+$/,
                    message: 'Selection must be a number'
                }
            }
        }, (err, result)=> {
            if (err) {
                subscriber.onError(err);
                return;
            }
            var selection = (parseInt(result['selection']) - 1);
            if (selection < 0 || selection >= targetIds.length) {
                subscriber.onError(new Error("Out of range selection: " + (selection + 1) + " of " +
                    targetIds.length));
            }
            subscriber.onNext(targetIds[selection]);
            subscriber.onCompleted();
        });
    }).map((targetId)=> {
        newAssignments[unassignedAssetId] = targetId;
        return newAssignments;
    });
}

export function askForVerifier(url) : Observable<string> {
    return Observable.create((subscriber : Subscriber<string>)=> {
        var subscription = new BooleanSubscription();
        open(url);
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
                subscriber.onNext(verifier);
                subscriber.onCompleted();
            }
        });
        return subscription;
    });
}
