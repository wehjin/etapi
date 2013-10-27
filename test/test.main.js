/**
 * Created by wehjin on 10/26/13.
 */
var mt = require("../moneypie");
var chai = require("chai");
var should = chai.should();

describe("moneytree", function(){

    it("calculates asset allocations", function(){
        var allocations = mt.makeAllocations([{
            name: "1",
            show: "First",
            fraction:.5
        },{
            name: "2",
            show: "Second",
            fraction:.2
        },{
            name: "3",
            show: "Third",
            fraction:1.0
        }]);
        allocations[2].fractionAll.should.eql(.4);
    });

    describe("makeReport", function(){
        var assets = [{
            type:"cash",
            symbol:"$",
            value: 20
        }, {
            type:"stock",
            symbol:"ibm",
            value: 60
        }, {
            type:"stock",
            symbol:"vt",
            value: 20
        }];
        var allocations = mt.makeAllocations([{
            name:"cash",
            show:"Cash",
            fraction:.2
        },{
            name:"global",
            show:"Global",
            fraction:.5
        },{
            name:"company",
            show:"Company",
            fraction:1
        }]);
        var assignments = {
            "$": "cash",
            "ibm": "company",
            "vt": "global"
        };
        var report = mt.makeReport(allocations, assets, assignments);

        it("calculates assetsValue", function(){
            report.assetsValue.should.equal(100.0);
        });

        it("calculates allocation fractions", function(){
            report.allocationFractions["cash"].should.equal(.2);
            report.allocationFractions["global"].should.equal(.2);
            report.allocationFractions["company"].should.equal(.6);
        });

        it("calculates allocation overflows", function(){
            report.allocationOverflows["cash"].should.equal(0);
            report.allocationOverflows["company"].should.be.closeTo(.5,.01);
            report.allocationOverflows["global"].should.be.closeTo(-.5,.01);
        });
    });
});