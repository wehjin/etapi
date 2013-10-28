/**
 * Created by wehjin on 10/26/13.
 */
var mt = require("./moneypie");
var argv = require("optimist").argv;
var fs = require('fs');
var tilde = require('tilde-expansion');
var _ = require('underscore');
var rx = require('rxjs');
var et = require('./etapi');

var dataFilePath = "~/.moneypie/data.json";
dataFilePath = argv.f ? argv.f : dataFilePath;
console.log("Data file path: ", dataFilePath);

var configFolderPath = "~/.moneypie";

function showable(amount, before, after) {
    before = before ? before : "";
    after = after ? after : "";
    return before + amount.toFixed(2) + after;
}

function presentAllocationReport(data) {
    var allocations = mt.makeAllocations(data.allocations);
    var assignments = data.assignments;
    var shares = data.shares;
    var symbols = _.keys(shares);
    rx.Observable.fromArray(symbols).select(function (symbol) {
        return rx.Observable.create(function (observer) {
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
            return function () {
            };
        });
    }).mergeObservable().select(function (asset) {
            var value = asset.price * asset.shares;
            asset.value = parseFloat(value.toFixed(2));
            return asset;
        }).toArray().subscribe(function (assets) {
            var report = mt.makeReport(allocations, assets, assignments);
            console.log("======================");
            console.log("TODAY", ":", new Date());
            console.log("TOTAL VALUE", ":", showable(report.assetsValue, "$"));
            console.log("UNASSIGNED", ":", showable(report.unassignedValue, "$"));
            console.log("\nOVERFLOWS");
            _.each(allocations, function (allocation) {
                var name = allocation.name;
                console.log(allocation.show, ":",
                    showable(report.allocationFractions[name] * 100, "", "%"),
                    "|",
                    showable(allocation.fractionAll * 100, "", "%"),
                    "->",
                    showable(report.allocationOverflows[name] * 100, "", "%"));
            });
        });
}

function getApi(data) {
    var sandbox = true;
    var consumerKey = data.etrade.sandbox_key;
    var consumerSecret = data.etrade.sandbox_secret;
    var api = et.makeApi(consumerKey, consumerSecret, sandbox);
    return api;
}

function presentUpdate(data) {
    console.log("\nUpdate\n===========================");
    var api = getApi(data);
    var url = api.getAccountsUrl("/rest/accountlist.json");
    api.getData(url).subscribe(function(data){
        var str = JSON.stringify(data, undefined, 2)
        console.log("Data\n", str);
    }, function(e) {
        console.error(e);
    });
}

function writeJSONFile(path, data, mode) {
    return rx.Observable.create(function(observer){
        fs.writeFile(path, JSON.stringify(data, undefined, 2), {mode: mode}, function(err) {
            if (err) {
                observer.onError(err);
            } else {
                observer.onNext(data);
                observer.onCompleted();
            }
        });
        return function(){};
    });
}

function readJSONFile(path) {
    return rx.Observable.create(function(observer){
        fs.readFile(path, function(err, data){
            if (err) {
                observer.onError(err);
            } else {
                var result = JSON.parse(data);
                observer.onNext(result);
                observer.onCompleted();
            }
        });
        return function(){};
    });
}

function getConfigFolderPath() {
    var configFolderPath = "~/.moneypie";
    return rx.Observable.create(function(observer){
        tilde(configFolderPath, function(expandedPath) {
            if (expandedPath == configFolderPath) {
                observer.onError("Failed to expand " + configFolderPath);
            } else {
                observer.onNext(expandedPath);
                observer.onCompleted();
            }
        });
        return function(){};
    });
}

function getAccessPath() {
    return getConfigFolderPath().select(function (folderPath) {
        return folderPath + "/access.json";
    });
}
function writeAccessToken(accessToken) {
    return getAccessPath().selectMany(function (accessPath) {
        return writeJSONFile(accessPath, accessToken, 0600);
    });
}

function readAccessToken() {
    return getAccessPath().selectMany(function(accessPath){
        return readJSONFile(accessPath);
    });
}

function presentLogin(data) {
    var api = getApi(data);
    api.getAccess().selectMany(function(accessToken){
        console.log("Access Token:", accessToken);
        return writeAccessToken(accessToken);
    }).subscribe(function(accessToken){
            console.log('Logged in');
    }, function(e){
       console.error(e);
    });

}

function getApiData(api, url) {
    return readAccessToken()
        .selectMany(function (accessToken) {
            return api.getDataWithAccess(url, accessToken);
        });
}

function getAccountsList(api) {
    var url = api.getAccountsUrl("/rest/accountlist.json");
    return getApiData(api, url)
        .select(function (data) {
            return data["json.accountListResponse"].response;
        });
}

function presentAccounts(data) {
    console.log("\nACCOUNTS");
    console.log("=======================")
    var api = getApi(data);
    getAccountsList(api).subscribe(function(data){
        var str = JSON.stringify(data, undefined, 2)
        console.log(str);
    }, function(e) {
        console.error(e);
    });
}

function getAccountSummaries(api) {
    return getAccountsList(api).selectMany(function (accountsList) {
        return rx.Observable.fromArray(accountsList);
    });
}
function getGatedAccountSummaries(api) {
    return getAccountSummaries(api)
        .zip(rx.Observable.interval(400), function (account, count) {
            return account;
        });
}
function getBalances(api) {
    return getGatedAccountSummaries(api)
        .selectMany(function (account) {
            var accountId = account.accountId;
            var url = api.getAccountsUrl("/rest/accountbalance/" + accountId + ".json");
            return getApiData(api, url);
        })
        .select(function (apiResponse) {
            return apiResponse["json.accountBalanceResponse"];
        });
}
function getCashAssets(api) {
    return getBalances(api)
        .select(function(balanceResponse){
            console.log("Balance Response\n", balanceResponse);
            var cashValue = parseFloat(balanceResponse.accountBalance.netCash);
            return {
                type: "cash",
                symbol: "$",
                value: cashValue
            };
        });
}
function getAssets(api) {
    return getGatedAccountSummaries(api)
        .selectMany(function (account) {
            var accountId = account.accountId;
            var url = api.getAccountsUrl("/rest/accountpositions/" + accountId + ".json");
            return getApiData(api, url);
        })
        .select(function (data) {
            var response = data["json.accountPositionsResponse"].response;
            return  response ? response : [];
        })
        .selectMany(function (data) {
            return rx.Observable.fromArray(data);
        })
        .selectMany(function (position) {
            //console.log(JSON.stringify(position));
            var symbol = position.productId.symbol.toLowerCase();
            var type = position.productId.typeCode.toLowerCase();
            var value = parseFloat(position.marketValue);
            var direction = position.longOrShort.toLowerCase();
            var array = direction === "long" ? [
                {
                    symbol: symbol,
                    value: value,
                    type: type
                }
            ] : [];
            return rx.Observable.fromArray(array);
        })
        .toArray();
}
function presentAssets(data) {
    var api = getApi(data);

    console.log("\nASSETS");
    console.log("=======================")
    getAssets(api)
        .subscribe(function(data){
            var str = JSON.stringify(data, undefined, 2);
            console.log(str);
        }, function(e) {
            console.error(e);
            process.exit();
        }, function(){
            console.log("Done!");
            process.exit();
        });
}
function presentBalances(data) {
    var api = getApi(data);

    console.log("\nBALANCES");
    console.log("=======================")
    getBalances(api)
        .subscribe(function(data){
            var str = JSON.stringify(data, undefined, 2);
            console.log(str);
        }, function(e) {
            console.error(e);
            process.exit();
        }, function(){
            console.log("Done!");
            process.exit();
        });
}
function presentCash(data) {
    var api = getApi(data);

    console.log("\nCASH");
    console.log("=======================")
    getCashAssets(api)
        .subscribe(function(data){
            var str = JSON.stringify(data, undefined, 2);
            console.log(str);
        }, function(e) {
            console.error(e);
            process.exit();
        }, function(){
            console.log("Done!");
            process.exit();
        });
}

var command = presentAllocationReport;
if (argv._.length > 0) {
    var commandName = argv._[0];
    if (commandName === 'update') {
        command = presentUpdate;
    } else if (commandName === 'login') {
        command = presentLogin;
    } else if (commandName === 'accounts') {
        command = presentAccounts;
    } else if (commandName === 'assets') {
        command = presentAssets;
    } else if (commandName === 'balances') {
        command = presentBalances;
    } else if (commandName === 'cash') {
        command = presentCash;
    }
}

tilde(dataFilePath, function(expandedPath) {
    console.log("Expanded: ", expandedPath);
    fs.readFile(expandedPath, 'utf8', function (err, data) {
        if (err) {
            console.log('Error: ' + err);
            return;
        }

        data = JSON.parse(data);
        command(data);
    });
});
