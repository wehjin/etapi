/**
 * @author  wehjin
 * @since   8/28/15
 */

///<reference path="./typings/oauth/oauth.d.ts"/>
///<reference path="node_modules/rxts/rxts.d.ts"/>

import Oauth = require("oauth");
import {Observable,Subscriber, BooleanSubscription} from "rxts";

export class TokenError implements Error {
    name : string;
    message : string;

    constructor(name : string, message : string) {
        this.name = name;
        this.message = message;
    }
}
export class TokenExpiredError extends TokenError implements Error {
    constructor(message : string) {
        super("TokenExpired", message);
    }
}

export class TokenRejectedError extends TokenError implements Error {
    constructor(message : string) {
        super("TokenRejected", message);
    }
}

export interface Jsonable {
    toJson():string;
}

export class Account {
    accountDescription : string;
    accountId : number;
    marginLevel : string;
    netAccountValue : number;
    registrationType : string;
    balance : Object;
    positions : Object;

    constructor(json : Object, public accessToken : AccessToken) {
        this.accountDescription = json['accountDesc'];
        this.accountId = json['accountId'];
        this.marginLevel = json['marginLevel'];
        this.netAccountValue = json['netAccountValue'];
        this.registrationType = json['registrationType'];
    }

    static fromJson(jsonAccount : Object, accessToken : AccessToken) : Account {
        var account = new Account(jsonAccount, accessToken);
        account.balance = jsonAccount['balance'];
        account.positions = jsonAccount['positions'];
        return account;
    }

    private getResourceUrl(resource) {
        return this.accessToken.service.getAccountsUrl() + "/" + resource + "/" +
            this.accountId + ".json";
    }

    refreshBalance() : Observable<Account> {
        var url = this.getResourceUrl("accountbalance");
        return this.accessToken.fetchSecuredResource(url).map((json : Object)=> {
            this.balance = json['json.accountBalanceResponse']['accountBalance'];
            return this;
        });
    }

    refreshPositions() : Observable<Account> {
        var url = this.getResourceUrl("accountpositions");
        return this.accessToken.fetchSecuredResource(url).map((json : Object)=> {
            var response = json['json.accountPositionsResponse']['response'];
            this.positions = response || [];
            return this;
        });
    }

    getCash() : number {
        return this.balance['netCash'];
    }
}

export class AccountList implements Jsonable {

    constructor(public accounts : Account[], public date : Date, public accessToken : AccessToken) {
    }

    toJson() : string {
        return JSON.stringify(this, (key : string, value : any)=> {
            return key === 'accessToken' ? undefined : value;
        });
    }

    static fromJson(jsonAccountList : Object, accessToken : AccessToken) : AccountList {
        var jsonAccounts = jsonAccountList['accounts'];
        var accounts : Account[] = [];
        for (var i = 0; i < jsonAccounts.length; i++) {
            var account : Account = Account.fromJson(jsonAccounts[i], accessToken);
            accounts.push(account);
        }
        return new AccountList(accounts, new Date(jsonAccountList['date']), accessToken);
    }

    private eachAccount(each : (account : Account)=>Observable<Account>) : Observable<AccountList> {
        return Observable.from(this.accounts)
            .flatMap((n)=> {
                var count = 0;
                var start;
                return Observable.create((subscriber : Subscriber<Account>)=> {
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
                    } else {
                        var subscription = new BooleanSubscription();
                        setTimeout(()=> {
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
            .map((accounts : Account[]) => {
                this.accounts = accounts;
                return this;
            });
    }

    refreshPositions() : Observable<AccountList> {
        return this.eachAccount((account : Account) : Observable<Account>=> {
            return account.refreshPositions();
        });
    }

    refreshBalances() : Observable<AccountList> {
        return this.eachAccount((account : Account) : Observable<Account>=> {
            return account.refreshBalance();
        });
    }

    getCash() : number {
        var cash = 0;
        for (var i = 0; i < this.accounts.length; i++) {
            cash += this.accounts[i].getCash();
        }
        return cash;
    }
}

export class AccessToken implements Jsonable {

    constructor(public token : string, public secret : string, public flags : Object,
                public service : Service) {
    }

    toJson() : string {
        return JSON.stringify(this, (key, value)=> {
            return key === 'service' ? undefined : value;
        });
    }

    fetchSecuredResource(url : string) : Observable<Object> {
        return Observable.create((subscriber : Subscriber<Object>)=> {
            var oauth = this.service.oauth;
            var subscription = new BooleanSubscription();
            oauth.get(url, this.token, this.secret, (err, data, response)=> {
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
                                    } else if (message === "oauth_problem=token_rejected") {
                                        send = new TokenRejectedError(message);
                                    } else {
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
    }

    fetchAccountList() : Observable<AccountList> {
        return this.fetchSecuredResource(this.service.getAccountListUrl())
            .map((json : Object) : AccountList => {
                var accountsJson = <Object[]>json['json.accountListResponse']['response'];
                var accounts = <Account[]>[];
                for (var i = 0; i < accountsJson.length; i++) {
                    accounts.push(new Account(accountsJson[i], this));
                }
                return new AccountList(accounts, new Date(), this);
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