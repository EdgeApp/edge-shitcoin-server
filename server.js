// server.js

// BASE SETUP
// =============================================================================

// call the packages we need
var express    = require('express');        // call express
var app        = express();                 // define our app using express
var bodyParser = require('body-parser');
var random     = require('random-js')
var cors       = require('cors')
// var mongoose   = require('mongoose');

// mongoose.connect('mongodb://node:localhost:27017/'); // connect to our database
// var Address     = require('./app/models/address');

// configure app to use bodyParser()
// this will let us get the data from a POST
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cors())

var port = process.env.PORT || 8080;        // set our port

// Nano for CouchDB
// =============================================================================
var nano = require('nano')('http://localhost:5984')
var db_transactions
var db_addresses
var init = true

if (init) {
  nano.db.destroy('db_transactions', function(err, body, header) {
    nano.db.destroy('db_addresses', function(err, body, header) {
      nano.db.create('db_transactions', function(err, body, header) {
        if (err) { return err }
        db_transactions = nano.db.use('db_transactions')
        nano.db.create('db_addresses', function(err, body, header) {
          if (err) { return err }
          db_addresses = nano.db.use('db_addresses')
        })
      })
    })
  })
} else {
  db_transactions = nano.db.use('db_transactions')
  db_addresses = nano.db.use('db_addresses')
}

// ROUTES FOR OUR API
// =============================================================================
var router = express.Router();              // get an instance of the express Router

// middleware to use for all requests
router.use(function(req, res, next) {
    // do logging
    console.log('Something is happening.');
    next(); // make sure we go to the next routes and don't stop here
});

router.get('/address/:address_id', function(req, res) {
    console.log('API /address/' + req.params.address_id)
    db_addresses.get(req.params.address_id, function(err, response) {
        if (err) {
          if (err.error == 'not_found') {
            // Create address with default funds
            createAddress(req.params.address_id, function(err, response) {
              if (err) {
                res.json(err);
              } else {
                res.json(response);
              }
            })
          } else {
            res.json(err);
          }
        } else {
          res.json(response);
        }
    })
});

router.get('/transaction/:tx_id', function(req, res) {
    console.log('API /transaction/' + req.params.tx_id)
    db_transactions.get(req.params.tx_id, function(err, response) {
        if (err) {
          res.json(err)
        } else {
          res.json(response)
        }
    })
});

router.post('/spend', function(req, res) {
  var inputs = req.body.inputs
  var outputs = req.body.outputs

  // Make sure all inputs are >= outputs
  var totalInputs = 0
  var totalOutputs = 0
  for (var n in inputs) {
    if (inputs[n].amount < 0) {
      res.json({err: "Error: negative input"})
      return
    }
    totalInputs += inputs[n].amount
  }

  for (var n in outputs) {
    if (outputs[n].amount < 0) {
      res.json({err: "Error: negative output"})
      return
    }
    totalOutputs += outputs[n].amount
  }
  if (totalOutputs > totalInputs) {
    res.json({err: "Error: Insufficient funds"})
    return
  }

  const networkFee = totalInputs - totalOutputs

  // Make sure all input addresses at least have sufficient funds
  var chkInputs = inputs.slice()
  checkInputs(chkInputs, function (err, response) {
    if (err) {
      res.json(err)
    } else {
      const r = random()
      const txid = r.hex(24)

      txObj = {
        networkFee: networkFee,
        inputs: inputs,
        outputs: outputs
      }

      // Put the new transaction in the tx database
      db_transactions.insert(txObj, txid, function (err, response) {
        if (err) {
          res.json(err)
        } else {
          // Update input addresses and output addresses with new balances and
          // Add txid to their lists
          var spInputs = inputs.slice()
          spendInputOutputs(spInputs, 1, txid, function (err, response) {
            if (err) {
              res.json(err)
            } else {
              var spOutputs = outputs.slice()
              spendInputOutputs(spOutputs, 0, txid, function (err, response) {
                if (err) {
                  res.json(err)
                } else {
                  res.json({ status: "Successful Spend", txid: txid })
                }
              })
            }
          })
        }
      })
    }
  })
})
// more routes for our API will happen here

// REGISTER OUR ROUTES -------------------------------
// all of our routes will be prefixed with /api
app.use('/api', router);

// START THE SERVER
// =============================================================================
app.listen(port);
console.log('Magic happens on port ' + port);

function createAddress(addr, cb) {
  // Parse out the last part of address after "__"
  const parts = addr.split('__')
  var amountString = ''
  var amountInt = 0
  if (parts.length > 1) {
    amountString = parts[parts.length - 1]
    amountInt = parseInt(amountString)
  }
  const r = random()
  const txid = r.hex(24)

  // Insert the new address

  const addressObj = {
    balance: amountInt,
    txids: [
      txid
    ]
  }

  db_addresses.insert(addressObj, addr, function (err, res) {
    if (err)
      cb(err)
    else if (amountInt) {

      const txObj = {
        inputs: [
          { address: 'coinbase_tx', amount: amountInt }
        ],
        outputs: [
          { address: addr, amount: amountInt }
        ],
        networkFee: 0
      }
      db_transactions.insert(txObj, txid, function (err, res) {
        if (err) {
          cb(err)
        } else {
          cb(null, addressObj)
        }
      })
    } else {
      cb(null, addressObj)
    }
  })

}

function checkInputs (inputs, cb) {
  if (inputs.length == 0) {
    cb(null, true)
  } else {
    db_addresses.get(inputs[0].address, function (err, res) {
      if (err) {
        cb(err)
      } else {
        if (res.balance >= inputs[0].amount) {
          inputs.splice(0, 1)
          checkInputs(inputs, cb)
        } else {
          cb({error: "Insufficient funds in address " + inputs[i].address})
        }
      }
    })
  }
}

function spendInputOutputs (inOuts, bIn, txid, cb) {
  if (inOuts.length == 0) {
    cb(null)
  } else {
    db_addresses.get(inOuts[0].address, function (err, res) {
      if (err) {
        cb(err)
      } else {
        var amt = inOuts[0].amount
        if (bIn) {
          amt *= -1
        }
        res.balance += amt
        res.txids = res.txids.concat(txid)

        db_addresses.insert(res, inOuts[ 0 ].address, function (err, res) {
          if (err) {
            cb(err)
          } else {
            inOuts.splice(0,1)
            spendInputOutputs(inOuts, bIn, txid, cb)
          }
        })
      }
    })
  }
}
