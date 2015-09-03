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
    function askForOldTarget(existingNames) {
        return rxts_1.Observable.create(function (subscriber) {
            var count = existingNames.length;
            prompt.start();
            prompt.get({
                properties: {
                    position: {
                        type: 'number',
                        pattern: /^\d+$/,
                        message: 'Enter a position between 1 and ' + count,
                        minimum: 1,
                        maximum: count,
                        divisibleBy: 1,
                        required: true,
                        "default": count
                    }
                }
            }, function (err, result) {
                if (err) {
                    subscriber.onError(err);
                    return;
                }
                subscriber.onNext(parseInt(result['position']) - 1);
                subscriber.onCompleted();
            });
        });
    }
    exports.askForOldTarget = askForOldTarget;
    function askForNewTarget(existingNames) {
        return rxts_1.Observable.create(function (subscriber) {
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
                        conform: function (v) {
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
                        'default': 0
                    }
                }
            }, function (err, result) {
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
    exports.askForNewTarget = askForNewTarget;
    function askForTargetOperation(formattedTargets) {
        return formattedTargets
            .flatMap(function (formatted) {
            console.log(formatted);
            return rxts_1.Observable.create(function (subscriber) {
                prompt.start();
                prompt.get({
                    properties: {
                        command: {
                            enum: ['+', '-', '='],
                            required: true,
                            description: "+, -, =",
                            'default': "="
                        }
                    }
                }, function (err, result) {
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
    exports.askForTargetOperation = askForTargetOperation;
    function askForAssignments(unassignedAssetIds, targetIds) {
        var chain;
        for (var i = 0; i < unassignedAssetIds.length; i++) {
            if (!chain) {
                chain = askForAssignment({}, unassignedAssetIds[0], targetIds);
                continue;
            }
            function chainAsk(chainIndex) {
                return function (newAssignments) {
                    var unassignedAssetId = unassignedAssetIds[chainIndex];
                    return askForAssignment(newAssignments, unassignedAssetId, targetIds);
                };
            }
            chain = chain.flatMap(chainAsk(i));
        }
        return chain;
    }
    exports.askForAssignments = askForAssignments;
    function askForAssignment(newAssignments, unassignedAssetId, targetIds) {
        return rxts_1.Observable.create(function (subscriber) {
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
            }, function (err, result) {
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
        }).map(function (targetId) {
            newAssignments[unassignedAssetId] = targetId;
            return newAssignments;
        });
    }
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