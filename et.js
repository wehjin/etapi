/**
 * @author  wehjin
 * @since   8/28/15
 */
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
};
(function (deps, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        var v = factory(require, exports); if (v !== undefined) module.exports = v;
    }
    else if (typeof define === 'function' && define.amd) {
        define(deps, factory);
    }
})(["require", "exports", "oauth", "rxts"], function (require, exports) {
    ///<reference path="./typings/oauth/oauth.d.ts"/>
    ///<reference path="node_modules/rxts/rxts.d.ts"/>
    var Oauth = require("oauth");
    var rxts_1 = require("rxts");
    var TokenError = (function () {
        function TokenError(name, message) {
            this.name = name;
            this.message = message;
        }
        return TokenError;
    })();
    exports.TokenError = TokenError;
    var TokenExpiredError = (function (_super) {
        __extends(TokenExpiredError, _super);
        function TokenExpiredError(message) {
            _super.call(this, "TokenExpired", message);
        }
        return TokenExpiredError;
    })(TokenError);
    exports.TokenExpiredError = TokenExpiredError;
    var TokenRejectedError = (function (_super) {
        __extends(TokenRejectedError, _super);
        function TokenRejectedError(message) {
            _super.call(this, "TokenRejected", message);
        }
        return TokenRejectedError;
    })(TokenError);
    exports.TokenRejectedError = TokenRejectedError;
    var Account = (function () {
        function Account(json, accessToken) {
            this.accessToken = accessToken;
            this.accountDescription = json['accountDesc'];
            this.accountId = json['accountId'];
            this.marginLevel = json['marginLevel'];
            this.netAccountValue = json['netAccountValue'];
            this.registrationType = json['registrationType'];
        }
        Account.fromJson = function (jsonAccount, accessToken) {
            var account = new Account(jsonAccount, accessToken);
            account.balance = jsonAccount['balance'];
            account.positions = jsonAccount['positions'];
            return account;
        };
        Account.prototype.getResourceUrl = function (resource) {
            return this.accessToken.service.getAccountsUrl() + "/" + resource + "/" +
                this.accountId + ".json";
        };
        Account.prototype.refreshBalance = function () {
            var _this = this;
            var url = this.getResourceUrl("accountbalance");
            return this.accessToken.fetchSecuredResource(url).map(function (json) {
                _this.balance = json['json.accountBalanceResponse']['accountBalance'];
                return _this;
            });
        };
        Account.prototype.refreshPositions = function () {
            var _this = this;
            var url = this.getResourceUrl("accountpositions");
            return this.accessToken.fetchSecuredResource(url).map(function (json) {
                var response = json['json.accountPositionsResponse']['response'];
                _this.positions = response || [];
                return _this;
            });
        };
        Account.prototype.getCash = function () {
            return this.balance['netCash'];
        };
        return Account;
    })();
    exports.Account = Account;
    var AccountList = (function () {
        function AccountList(accounts, date, accessToken) {
            this.accounts = accounts;
            this.date = date;
            this.accessToken = accessToken;
        }
        AccountList.prototype.toJson = function () {
            return JSON.stringify(this, function (key, value) {
                return key === 'accessToken' ? undefined : value;
            });
        };
        AccountList.fromJson = function (jsonAccountList, accessToken) {
            var jsonAccounts = jsonAccountList['accounts'];
            var accounts = [];
            for (var i = 0; i < jsonAccounts.length; i++) {
                var account = Account.fromJson(jsonAccounts[i], accessToken);
                accounts.push(account);
            }
            return new AccountList(accounts, new Date(jsonAccountList['date']), accessToken);
        };
        AccountList.prototype.eachAccount = function (each) {
            var _this = this;
            return rxts_1.Observable.from(this.accounts)
                .flatMap(function (n) {
                var count = 0;
                var start;
                return rxts_1.Observable.create(function (subscriber) {
                    var now = Date.now();
                    if (count === 0) {
                        start = now;
                    }
                    count++;
                    var horizon = start + count * 150;
                    var delay = Math.max(0, horizon - now);
                    if (delay === 0) {
                        subscriber.onNext(n);
                        subscriber.onCompleted();
                    }
                    else {
                        var subscription = new rxts_1.BooleanSubscription();
                        setTimeout(function () {
                            if (subscriber.isUnsubscribed()) {
                                return;
                            }
                            subscriber.onNext(n);
                            subscriber.onCompleted();
                        }, delay);
                        subscriber.addSubscription(subscription);
                    }
                });
            })
                .flatMap(each)
                .toList()
                .map(function (accounts) {
                _this.accounts = accounts;
                return _this;
            });
        };
        AccountList.prototype.refreshPositions = function () {
            return this.eachAccount(function (account) {
                return account.refreshPositions();
            });
        };
        AccountList.prototype.refreshBalances = function () {
            return this.eachAccount(function (account) {
                return account.refreshBalance();
            });
        };
        AccountList.prototype.getCash = function () {
            var cash = 0;
            for (var i = 0; i < this.accounts.length; i++) {
                cash += this.accounts[i].getCash();
            }
            return cash;
        };
        return AccountList;
    })();
    exports.AccountList = AccountList;
    var AccessToken = (function () {
        function AccessToken(token, secret, flags, service) {
            this.token = token;
            this.secret = secret;
            this.flags = flags;
            this.service = service;
        }
        AccessToken.prototype.toJson = function () {
            return JSON.stringify(this, function (key, value) {
                return key === 'service' ? undefined : value;
            });
        };
        AccessToken.prototype.fetchSecuredResource = function (url) {
            var _this = this;
            return rxts_1.Observable.create(function (subscriber) {
                var oauth = _this.service.oauth;
                var subscription = new rxts_1.BooleanSubscription();
                oauth.get(url, _this.token, _this.secret, function (err, data, response) {
                    if (subscription.isUnsubscribed()) {
                        return;
                    }
                    if (err) {
                        var send = err;
                        if (err['statusCode'] === 401) {
                            var body = err['data'];
                            if (body) {
                                var errorInBody = JSON.parse(body)['Error'];
                                if (errorInBody) {
                                    var message = errorInBody['message'];
                                    if (message) {
                                        if (message === "oauth_problem=token_expired") {
                                            send = new TokenExpiredError(message);
                                        }
                                        else if (message === "oauth_problem=token_rejected") {
                                            send = new TokenRejectedError(message);
                                        }
                                        else {
                                            send = new Error(message);
                                        }
                                    }
                                }
                            }
                        }
                        subscriber.onError(send);
                        return;
                    }
                    subscriber.onNext(JSON.parse(data));
                    subscriber.onCompleted();
                });
                subscriber.addSubscription(subscription);
            });
        };
        AccessToken.prototype.fetchAccountList = function () {
            var _this = this;
            return this.fetchSecuredResource(this.service.getAccountListUrl())
                .map(function (json) {
                var accountsJson = json['json.accountListResponse']['response'];
                var accounts = [];
                for (var i = 0; i < accountsJson.length; i++) {
                    accounts.push(new Account(accountsJson[i], _this));
                }
                return new AccountList(accounts, new Date(), _this);
            });
        };
        return AccessToken;
    })();
    exports.AccessToken = AccessToken;
    var Credentials = (function () {
        function Credentials(verifier, requestToken) {
            this.verifier = verifier;
            this.requestToken = requestToken;
        }
        Credentials.prototype.getAccessToken = function () {
            var _this = this;
            var oauth = this.requestToken.service.oauth;
            return rxts_1.Observable.create(function (subscriber) {
                var subscription = new rxts_1.BooleanSubscription();
                oauth.getOAuthAccessToken(_this.requestToken.token, _this.requestToken.secret, _this.verifier, function (err, accessToken, accessSecret, accessResults) {
                    if (subscription.isUnsubscribed()) {
                        return;
                    }
                    if (err) {
                        subscriber.onError(err);
                        return;
                    }
                    subscriber.onNext(new AccessToken(accessToken, accessSecret, accessResults, _this.requestToken.service));
                    subscriber.onCompleted();
                });
                subscriber.addSubscription(subscription);
            });
        };
        return Credentials;
    })();
    exports.Credentials = Credentials;
    var OauthRequestToken = (function () {
        function OauthRequestToken(token, secret, flags, service) {
            this.token = token;
            this.secret = secret;
            this.flags = flags;
            this.service = service;
        }
        OauthRequestToken.prototype.getAuthenticationUrl = function () {
            var tokenClause = "token=" + encodeURIComponent(this.token);
            var keyClause = "key=" + encodeURIComponent(this.service.consumerKey);
            return "https://us.etrade.com/e/t/etws/authorize?" + keyClause + "&" + tokenClause;
        };
        return OauthRequestToken;
    })();
    exports.OauthRequestToken = OauthRequestToken;
    var Service = (function () {
        function Service(setup) {
            this.sandbox = setup['mode'] === 'sandbox';
            this.hostUrl = this.sandbox ? "https://etwssandbox.etrade.com" : "https://etws.etrade.com";
            var tokenUrl = "https://etws.etrade.com/oauth/request_token";
            var accessUrl = "https://etws.etrade.com/oauth/access_token";
            this.consumerKey = setup['sandbox_key'];
            var consumerSecret = setup['sandbox_secret'];
            this.oauth = new Oauth.OAuth(tokenUrl, accessUrl, this.consumerKey, consumerSecret, '1.0', "oob", 'HMAC-SHA1');
        }
        Service.prototype.getAccountsUrl = function () {
            return this.hostUrl + "/accounts" + (this.sandbox ? "/sandbox" : "") + "/rest";
        };
        Service.prototype.getAccountListUrl = function () {
            return this.getAccountsUrl() + "/accountlist.json";
        };
        Service.prototype.fetchRequestToken = function () {
            var _this = this;
            return rxts_1.Observable.create(function (subscriber) {
                var subscription = new rxts_1.BooleanSubscription();
                _this.oauth.getOAuthRequestToken(function (err, oauthToken, oauthTokenSecret, results) {
                    if (subscription.isUnsubscribed()) {
                        return;
                    }
                    if (err) {
                        subscriber.onError(err);
                    }
                    else {
                        subscriber.onNext(new OauthRequestToken(oauthToken, oauthTokenSecret, results, _this));
                        subscriber.onCompleted();
                    }
                });
                subscriber.addSubscription(subscription);
            });
        };
        return Service;
    })();
    exports.Service = Service;
});
//# sourceMappingURL=et.js.map