/**
 * Created by wehjin on 10/26/13.
 */
var _ = require('underscore');
var sets = require('simplesets');

function Allocation(name, show, fractionAll) {
    this.name = name;
    this.show = show;
    this.fractionAll = fractionAll;
}

exports.makeAllocations = function(allocationSpecs) {
    var remaining = 1.0;
    var allocations = _.map(allocationSpecs, function(spec){
        var allocated = remaining * spec.fraction;
        remaining = remaining - allocated;
        return new Allocation(spec.name, spec.show, allocated);
    });
    return allocations;
}

exports.makeReport = function(allocations, assets, assignments) {
    var totalValue = _.reduce(assets, function(sum, asset){
        return sum + asset.value;
    }, 0);

    var unassignedSymbols = _.reduce(assets, function(unassigned, asset){
        var allocationName = assignments[asset.symbol];
        if (!allocationName) {
            unassigned.push(asset.symbol);
        }
        return unassigned;
    }, []);
    var unassignedSet = new sets.Set(unassignedSymbols);

    var allocationTotals = _.reduce(assets, function(totals, asset){
        var allocationName = assignments[asset.symbol];
        var justAllocationName = allocationName ? allocationName : "_unassigned";

        var allocationTotal = totals[justAllocationName];
        var justAllocationTotal = allocationTotal ? allocationTotal : 0.0;
        totals[justAllocationName] = justAllocationTotal + asset.value;
        return totals;
    }, {});

    var unassignedTotal = allocationTotals['_unassigned'];
    var justUnassignedTotal = unassignedTotal ? unassignedTotal : 0;

    var allocationFractions = _.reduce(allocationTotals, function(result, value, key){
        result[key] = value/totalValue;
        return result;
    }, {});

    var allocationsByName = _.indexBy(allocations, "name");
    var allocationOverflows = _.reduce(allocationsByName, function(overflows, value, key){
        var preferred = value.fractionAll;
        var actual = allocationFractions[key];
        var justActual = actual ? actual : 0;
        var overage = justActual - preferred;
        var overflow = overage/preferred;
        overflows[key] = overflow;
        return overflows;
    }, {});

    return {
        assetsValue: totalValue,
        unassignedValue: justUnassignedTotal,
        unassignedSymbols: unassignedSet.array(),
        allocationFractions: allocationFractions,
        allocationOverflows: allocationOverflows
    };
}