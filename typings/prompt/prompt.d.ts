/**
 * @author  wehjin
 * @since   8/28/15
 */

declare module "prompt" {
    export function start();

    export function get(setup : string[], handler : (err : any, result : Object)=>void);
}