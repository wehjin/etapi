/**
 * Created by wehjin on 10/26/13.
 */
var mt = require("./moneypie");
var argv = require("optimist").argv;
var fs = require('fs');
var tilde = require('tilde-expansion');
var _ = require('underscore');
var rx = require('rxjs');
var request = require('request');

var dataFilePath = "~/.moneytree/data.json"
dataFilePath = argv.f ? argv.f : dataFilePath;
console.log("Data file path: ", dataFilePath);

function showable(amount, before, after) {
    before = before ? before : "";
    after = after ? after : "";
    return before + amount.toFixed(2) + after;
}

tilde(dataFilePath, function(expandedPath) {
    console.log("Expanded: ", expandedPath);
    fs.readFile(expandedPath, 'utf8', function (err, data) {
        if (err) {
            console.log('Error: ' + err);
            return;
        }

        data = JSON.parse(data);

        var allocations = mt.makeAllocations(data.allocations);
        var assignments = data.assignments;
        var shares = data.shares;
        var symbols = _.keys(shares);
        rx.Observable.fromArray(symbols).select(function(symbol){
            return rx.Observable.create(function(observer){
                var shareCount = shares[symbol];
                if (symbol == "$") {
                    observer.onNext({
                        symbol: symbol,
                        price: 1,
                        shares: shareCount
                    });
                    observer.onCompleted();
                } else {
                    var phrase = "select finance.symbol, finance.last.data from google.igoogle.stock where stock = '" + symbol + "'";
                    var selectParameter = encodeURIComponent(phrase);
                    var url = "http://query.yahooapis.com/v1/public/yql?q=" + selectParameter + "&format=json&env=store%3A%2F%2Fdatatables.org%2Falltableswithkeys&callback=";
                    request(url, function (error, response, body) {
                        if (!error && response.statusCode == 200) {
                            body = JSON.parse(body);
                            var price = parseFloat(body.query.results.xml_api_reply.finance.last.data);
                            observer.onNext({
                                symbol: symbol,
                                price: price,
                                shares: shareCount
                            });
                            observer.onCompleted();
                        } else {
                            observer.onError(error || response.statusText);
                        }
                    });
                }
                return function(){};
            });
        }).mergeObservable().select(function(asset){
                var value = asset.price * asset.shares;
                asset.value = parseFloat(value.toFixed(2));
                return asset;
            }).toArray().subscribe(function(assets){
                var report = mt.makeReport(allocations, assets, assignments);
                console.log("======================");
                console.log("TODAY",":",new Date());
                console.log("TOTAL VALUE", ":", showable(report.assetsValue, "$"));
                console.log("UNASSIGNED",":", showable(report.unassignedValue, "$"));
                console.log("\nOVERFLOWS");
                _.each(allocations, function(allocation){
                    var name = allocation.name;
                    console.log(allocation.show,":",
                        showable(report.allocationFractions[name] * 100,"", "%"),
                        "|",
                        showable(allocation.fractionAll * 100, "", "%"),
                        "->",
                        showable(report.allocationOverflows[name] * 100,"","%"));
                });
            });
    });
});
