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

export function askForNewTarget(existingNames : string[]) : Observable<[number,string,number]> {
    return Observable.create((subscriber : Subscriber<[number, string, number]>)=> {
        var count = existingNames.length;
        prompt.start();
        prompt.get({
            properties: {
                position: {
                    type: 'number',
                    pattern: /^\d+$/,
                    message: 'Enter a position between 1 and ' + (count + 1),
                    minimum: 1,
                    maximum: (count + 1),
                    divisibleBy: 1,
                    required: true,
                    "default": count + 1
                },
                name: {
                    type: 'string',
                    allowEmpty: false,
                    required: true,
                    conform: (v)=> {
                        return v.trim().length > 0;
                    }
                },
                proportion: {
                    type: 'number',
                    pattern: /^(0|1)([.]\d+)?$/,
                    minimum: 0,
                    maximum: 1,
                    message: 'Proportion must be between 0 and 1',
                    required: true,
                    'default': 0,
                }
            }
        }, (err, result)=> {
            if (err) {
                subscriber.onError(err);
                return;
            }
            var segmentName = result['name'];
            for (var i = 0; i < existingNames.length; i++) {
                if (existingNames[i] === segmentName) {
                    throw new Error("Duplicate segment name: " + segmentName);
                }
            }
            var index = (parseInt(result['position']) - 1);
            if (index < 0 || index > existingNames.length) {
                throw new RangeError(index.toString() + " not in 1.." + (count + 1));
            }
            subscriber.onNext([index, segmentName,
                               parseFloat(result['proportion'])]);
            subscriber.onCompleted();
        });
    });
}

export function askForTargetOperation(formattedTargets : Observable<string>) : Observable<string> {
    return formattedTargets
        .flatMap((formatted : string)=> {
            console.log(formatted);
            return Observable.create((subscriber : Subscriber<string>)=> {
                prompt.start();
                prompt.get({
                    properties: {
                        command: {
                            enum: ['+', '-', '='],
                            required: true,
                            description: "+, -, =",
                            'default': "=",
                        }
                    }
                }, (err, result)=> {
                    if (err) {
                        subscriber.onError(err);
                        return;
                    }
                    subscriber.onNext(result['command']);
                    subscriber.onCompleted();
                });
            });
        });
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
                subscriber.onError(new Error("Selection " + (selection + 1) +
                    " out of range [1.." + targetIds.length +
                    "]"));
                return;
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
