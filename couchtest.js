var nano = require('nano')('http://localhost:5984')
nano.db.destroy('shitcoin', function(err, body, header) {
  nano.db.create('shitcoin', function(err, body, header) {
    var shitcoin = nano.db.use('shitcoin')
    shitcoin.insert({ coin: 'BTC' }, '1w235heh28giu3t4g', function(err, body, header) {
        if (err) {
            console.log('[shitcoin.insert] ', err.message);
            return;
        }
        shitcoin.insert({ coin: 'ETH' }, '2xoiwefoywefoi2j4', function(err, body, header) {
            if (err) {
                console.log('[shitcoin.insert] ', err.message);
                return;
            }
            console.log(body);

            shitcoin.get('2xoiwefoywefoi2j4', function(err, body, header) {
                console.log(body)
            })
        })
    })
  })
})
