/**
 * @author  wehjin
 * @since   8/28/15
 */

///<reference path="./typings/oauth/oauth.d.ts"/>
///<reference path="node_modules/rxts/rxts.d.ts"/>

import Oauth = require("oauth");
import {Observable,Subscriber, BooleanSubscription} from "rxts";

export class Account {
    accountDescription : string;
    accountId : number;
    marginLevel : string;
    netAccountValue : number;
    registrationType : string;

    constructor(json : Object, public accessToken : AccessToken) {
        this.accountDescription = json['accountDesc'];
        this.accountId = json['accountId'];
        this.marginLevel = json['marginLevel'];
        this.netAccountValue = json['netAccountValue'];
        this.registrationType = json['registrationType'];
    }
}

export class AccountList {

    constructor(public accounts : Account[], public accessToken : AccessToken) {
    }
}

export class AccessToken {

    constructor(public token : string, public secret : string, public flags : Object,
                public service : Service) {
    }

    getAccountList() : Observable<AccountList> {
        return Observable.create((subscriber : Subscriber<AccountList>)=> {
            var accountListUrl = this.service.getAccountListUrl();
            var oauth = this.service.oauth;
            var subscription = new BooleanSubscription();
            oauth.get(accountListUrl, this.token, this.secret, (err, data, response)=> {
                if (subscription.isUnsubscribed()) {
                    return;
                }
                if (err) {
                    subscriber.onError(err);
                    return;
                }
                var fullResponse = JSON.parse(data);
                var accountsJson = <Object[]>fullResponse['json.accountListResponse']['response'];
                var accounts = <Account[]>[];
                for (var i = 0; i < accountsJson.length; i++) {
                    accounts.push(new Account(accountsJson[i], this));
                }
                subscriber.onNext(new AccountList(accounts, this));
                subscriber.onCompleted();
            });
            subscriber.addSubscription(subscription);
        });
    }

}

export class Credentials {

    constructor(public verifier : string, public requestToken : OauthRequestToken) {
    }

    getAccessToken() : Observable<Object> {
        var oauth = this.requestToken.service.oauth;
        return Observable.create((subscriber : Subscriber<Object>) : void=> {
            var subscription = new BooleanSubscription();
            oauth.getOAuthAccessToken(
                this.requestToken.token, this.requestToken.secret, this.verifier,
                (err, accessToken, accessSecret, accessResults) => {
                    if (subscription.isUnsubscribed()) {
                        return;
                    }
                    if (err) {
                        subscriber.onError(err);
                        return;
                    }
                    subscriber.onNext(new AccessToken(accessToken, accessSecret, accessResults,
                        this.requestToken.service));
                    subscriber.onCompleted();
                }
            );
            subscriber.addSubscription(subscription);
        });
    }
}

export class OauthRequestToken {

    constructor(public token : string, public secret : string, public flags : Object,
                public service : Service) {
    }

    getAuthenticationUrl() : string {
        var tokenClause = "token=" + encodeURIComponent(this.token);
        var keyClause = "key=" + encodeURIComponent(this.service.consumerKey);
        return "https://us.etrade.com/e/t/etws/authorize?" + keyClause + "&" + tokenClause;
    }
}

export class Service {
    private hostUrl : string;
    private sandbox : boolean;
    public oauth : Oauth.OAuth;
    public consumerKey;

    constructor(setup : Object) {
        this.sandbox = setup['mode'] === 'sandbox';
        this.hostUrl = this.sandbox ? "https://etwssandbox.etrade.com" : "https://etws.etrade.com";
        var tokenUrl = "https://etws.etrade.com/oauth/request_token";
        var accessUrl = "https://etws.etrade.com/oauth/access_token";

        this.consumerKey = setup['sandbox_key'];
        var consumerSecret = setup['sandbox_secret'];
        this.oauth = new Oauth.OAuth(tokenUrl, accessUrl, this.consumerKey, consumerSecret,
            '1.0', "oob", 'HMAC-SHA1');
    }

    getAccountsUrl() : string {
        return this.hostUrl + "/accounts" + (this.sandbox ? "/sandbox" : "") + "/rest";
    }

    getAccountListUrl() : string {
        return this.getAccountsUrl() + "/accountlist.json";
    }

    fetchRequestToken() : Observable<OauthRequestToken> {
        return Observable.create((subscriber : Subscriber<Object>)=> {
            var subscription = new BooleanSubscription();
            this.oauth.getOAuthRequestToken((err, oauthToken, oauthTokenSecret, results) => {
                if (subscription.isUnsubscribed()) {
                    return;
                }
                if (err) {
                    subscriber.onError(err);
                } else {
                    subscriber.onNext(new OauthRequestToken(oauthToken, oauthTokenSecret,
                        results,
                        this));
                    subscriber.onCompleted();
                }
            });
            subscriber.addSubscription(subscription);
        });
    }
}