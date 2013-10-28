/**
 * Created by wehjin on 10/27/13.
 */
var rx = require('rxjs');
var request = require('request');
var OAuth = require('OAuth');
var open = require('open');
var prompt = require('prompt');

function getRequestToken(oauth) {
    return rx.Observable.create(function(observer){
        oauth.getOAuthRequestToken(function(err, oauth_token, oauth_token_secret, results){
            if (err) {
                observer.onError(err);
            } else {
                observer.onNext({
                    requestToken: oauth_token,
                    requestTokenSecret: oauth_token_secret,
                    requestTokenResults: results
                });
                observer.onCompleted();
            }
        });
        return function(){};
    });
}

function getVerifier() {
    return rx.Observable.create(function(observer){
        prompt.start();
        prompt.get(['verifier'], function (err, result) {
            if (err) {
                observer.onError(err);
            } else {
                observer.onNext(result.verifier);
                observer.onCompleted();
            }
        });
        return function(){};
    });
}

function getAuthToken(authUrl, authCredentials) {
    var authUrlWithToken = authUrl + "&token=" + encodeURIComponent(authCredentials.requestToken);
    open(authUrlWithToken);
    return getVerifier().select(function (verifier) {
        if (!verifier) {
            throw "invalid verifier code";
        }
        return {
            requestCredentials: authCredentials,
            verifier: verifier
        };
    });
}

function getAccessToken(oauth, accessCredentials) {
    return rx.Observable.create(function(observer){
        oauth.getOAuthAccessToken(
            accessCredentials.requestCredentials.requestToken,
            accessCredentials.requestCredentials.requestTokenSecret,
            accessCredentials.verifier,
            function(err, oauth_access_token, oauth_access_token_secret, results) {
                if (err) {
                    observer.onError(err);
                } else {
                    var dataCredentials = {
                        accessToken: oauth_access_token,
                        accessTokenSecret: oauth_access_token_secret,
                        accessTokenResults: results,
                        accessCredentials: accessCredentials
                    };
                    observer.onNext(dataCredentials);
                    observer.onCompleted();
                }
            }
        );
        return function(){};
    });
}

exports.makeApi = function(consumerKey, consumerSecret) {
    var tokenUrl = "https://etws.etrade.com/oauth/request_token";
    var accessUrl = "https://etws.etrade.com/oauth/access_token";
    var authUrl = "https://us.etrade.com/e/t/etws/authorize?key=" + encodeURIComponent(consumerKey);

    var oauth = new OAuth.OAuth(
        tokenUrl, accessUrl, consumerKey, consumerSecret,
        '1.0', "oob", 'HMAC-SHA1'
    );

    function getAccess() {
        return getRequestToken(oauth)
            .selectMany(function(requestToken){
                console.log("Request token", requestToken);
                return getAuthToken(authUrl, requestToken);
            }).selectMany(function(authToken){
                console.log("Auth token", authToken);
                return getAccessToken(oauth, authToken);
            });
    }

    function getDataWithAccess(url, accessToken) {
        return rx.Observable.create(function(observer){
            oauth.get(url, accessToken.accessToken, accessToken.accessTokenSecret, function(err, data) {
                if (err) {
                    observer.onError(err);
                } else {
                    observer.onNext(JSON.parse(data));
                    observer.onCompleted();
                }
            });
            return function(){};
        });
    }

    function getData(url) {
        return getAccess().selectMany(function(accessToken){
            console.log("Access token", accessToken);
            return getDataWithAccess(url, accessToken);
        });
    }

    return {
        getData: getData,
        getAccess: getAccess,
        getDataWithAccess: getDataWithAccess
    }
};