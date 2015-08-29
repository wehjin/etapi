/**
 * @author  wehjin
 * @since   8/28/15
 */

declare module "oauth" {
    export class OAuth {

        constructor(tokenUrl : string, accessUrl : string, consumerKey : string,
                    consumerSecret : string, version : string, extra : string, hash : string);


        getOAuthRequestToken(onResult : (err : any, requestToken : string,
                                         requestSecret : string, results : any)=>void);

        getOAuthAccessToken(requestToken : string, requestSecret : string, requestVerifier : string,
                            onResult : (err : any, accessToken : string, accessSecret : string,
                                        results : any)=>void);
    }
}
