/**
 * @author  wehjin
 * @since   8/27/15
 */

///<reference path="node_modules/rxts/rxts.d.ts"/>
///<reference path="./typings/node/node.d.ts" />
///<reference path="./typings/open/open.d.ts" />
///<reference path="./typings/prompt/prompt.d.ts" />


import {Http,Observable,Subscriber,BooleanSubscription} from "rxts";
import {Jsonable} from "et";
import fs = require("fs");
import open = require("open");

export class NoEntryError implements Error {
    name : string = "NoEntryError";
    message : string;

    constructor(message : string) {
        this.message = message;
    }
}

export function readJson(filepath : string) : Observable<any> {
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

export function saveAny<T>(toSave : T, filePath : string) : Observable<T> {
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

export function saveJson<T extends Jsonable>(jsonable : T, filePath : string) : Observable<T> {
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

export function deleteJson(path) {
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
