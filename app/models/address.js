
var mongoose     = require('mongoose');
var Schema       = mongoose.Schema;

var AddressSchema   = new Schema({
    coinId: String,
    publicAddress: String,
    balance: Number
});

module.exports = mongoose.model('Address', AddressSchema);