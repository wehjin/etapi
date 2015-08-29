/**
 * @author  wehjin
 * @since   8/28/15
 */
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
                    }
                    else {
                        var credentials = _this;
                        subscriber.onNext({
                            token: accessToken,
                            secret: accessSecret,
                            flags: accessResults,
                            credentials: credentials
                        });
                        subscriber.onCompleted();
                    }
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
            return this.getAccountsUrl() + "/accountlist";
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