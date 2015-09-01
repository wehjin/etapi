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
})(["require", "exports", "rxts", "open", "prompt"], function (require, exports) {
    ///<reference path="node_modules/rxts/rxts.d.ts"/>
    ///<reference path="./typings/node/node.d.ts" />
    ///<reference path="./typings/open/open.d.ts" />
    ///<reference path="./typings/prompt/prompt.d.ts" />
    var rxts_1 = require("rxts");
    var open = require("open");
    var prompt = require("prompt");
    function askForAssignment(assetId, targetIds) {
        return rxts_1.Observable.create(function (subscriber) {
            var description = "Allocation for " + assetId + "\nChoices";
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
                        default: 1,
                        required: true,
                        pattern: /^\d+$/,
                        message: 'Selection must be a number'
                    }
                }
            }, function (err, result) {
                if (err) {
                    subscriber.onError(err);
                    return;
                }
                subscriber.onNext(targetIds[parseInt(result['selection']) - 1]);
                subscriber.onCompleted();
            });
        }).map(function (targetId) {
            return [assetId, targetId];
        });
    }
    exports.askForAssignment = askForAssignment;
    function askForVerifier(url) {
        return rxts_1.Observable.create(function (subscriber) {
            var subscription = new rxts_1.BooleanSubscription();
            open(url);
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
                    subscriber.onNext(verifier);
                    subscriber.onCompleted();
                }
            });
            return subscription;
        });
    }
    exports.askForVerifier = askForVerifier;
});
//# sourceMappingURL=etcl-human.js.map