#!/usr/local/bin/node

// server.js

// BASE SETUP
// =============================================================================

const GENESIS_BLOCK_TIME_MS = 1491004800000 // Apr 1, 2017 00:00 GMT
const BLOCK_TIME_SECONDS    = 60
const MINIMUM_NETWORK_FEE   = 20000
const PRIMARY_CURRENCY      = 'TRD'
const TOKEN_CODES           = ['ANA', 'DOGESHIT', 'CRAP']

// call the packages we need
var express    = require('express');        // call express
var app        = express();                 // define our app using express
var bodyParser = require('body-parser');
var random     = require('random-js')
var cors       = require('cors')

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

// BASE CLASSES
// =============================================================================

class InOutObj {
  constructor (currencyCode, address, amount) {
    this.currencyCode = currencyCode
    this.address      = address
    this.amount       = amount
  }
}

class TxObj {
  constructor (inputs, outputs, networkFee=0, blockHeight=0) {
    const r = random()
    this.txid         = r.hex(24)
    this.networkFee   = networkFee
    this.inputs       = inputs
    this.outputs      = outputs
    this.txDate       = (new Date()).getTime()
    this.blockHeight  = blockHeight
  }
}

class AddressObj {
  constructor (address, trdAmount, txids) {
    this.address                    = address
    this.amounts                    = {}
    this.amounts[PRIMARY_CURRENCY]  = trdAmount
    this.txids                      = txids

    for (const n in TOKEN_CODES) {
      const code = TOKEN_CODES[n]
      this.amounts[code] = trdAmount * (Number(n)+2)
    }

  }
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
  db_addresses.get(req.params.address_id, function(err, addressObj) {
    if (err) {
      if (err.error == 'not_found') {
        // Create address with default funds
        createAddress(req.params.address_id, function(err, addressObj2) {
          if (err) {
            res.json(err);
          } else {
            res.json(addressObj2);
          }
        })
      } else {
        res.json(err);
      }
    } else {
      res.json(addressObj);
    }
  })
});

function getBlockHeight(unixTimeSeconds) {
  // 60s blocks starting at Jan 1 2017 GMT
  var numBlocks = (unixTimeSeconds - GENESIS_BLOCK_TIME_MS) / (1000 * BLOCK_TIME_SECONDS)
  numBlocks = Math.floor(numBlocks)
  return numBlocks
}

function addBlockHeightToTransaction (txObj) {
  let txHeight = getBlockHeight(txObj.txDate) + 3

  const now = (new Date()).getTime()
  const blockHeight = getBlockHeight(now)

  if (blockHeight - txHeight < 0) {
    txHeight = 0
  }
  txObj.blockHeight = txHeight
}

router.get('/transaction/:tx_id', function(req, res) {
    console.log('API /transaction/' + req.params.tx_id)
    db_transactions.get(req.params.tx_id, function(err, response) {
        if (err) {
          res.json(err)
        } else {
          addBlockHeightToTransaction(response)
          res.json(response)
        }
    })
})

router.get('/height', function(req, res) {
  console.log('API /height/')
  const d = new Date()
  var response = {
    height: getBlockHeight(d.getTime())
  }
  res.json(response)
})

router.post('/add_token', function(req, res) {
  const currencyCode  = req.body.currencyCode
  const address       = req.body.address
  const amount        = req.body.amount

  // Create Tx that spends from coinbase_tx to address with currencyCode
  const input   = new InOutObj(currencyCode, 'coinbase_tx', amount)
  const output  = new InOutObj(currencyCode, address, amount)
  const txObj = new TxObj([input], [output])

  // Get addressObj from DB
  db_addresses.get(address, function (err, addressObj) {
    if (err) {
      res.json(err)
      return
    }
    // Add txid and new amount to addressObj
    addressObj.txids.push(txObj.txid)
    if (addressObj.amounts[currencyCode] == undefined) {
      addressObj.amounts[currencyCode] = 0
    }
    addressObj.amounts[currencyCode] += amount

    // Update addressObj and create new tx in db
    db_addresses.insert(addressObj, addressObj.address, function (err, response1) {
      if (err) {
        res.json(err)
      } else {
        db_transactions.insert(txObj, txObj.txid, function (err, response2) {
          if (err) {
            res.json(err)
          } else {
            res.json(addressObj)
          }
        })
      }
    })
  })

})

router.post('/spend', function(req, res) {
  let inputs = req.body.inputs
  let outputs = req.body.outputs

  // Make sure all inputs are >= outputs
  let totalInputs = {}
  totalInputs[PRIMARY_CURRENCY] = 0
  let totalOutputs = {}
  totalOutputs[PRIMARY_CURRENCY] = 0
  let currencyCodes = [ PRIMARY_CURRENCY ]

  for (var n in inputs) {
    const input = inputs[n]
    if (input.amount < 0) {
      res.json({err: "Error: negative input"})
      return
    }
    const currencyCode = input.currencyCode
    if (totalInputs[currencyCode] == undefined) {
      totalInputs[currencyCode] = 0
    }
    totalInputs[currencyCode] += input.amount

    if (currencyCodes.indexOf(currencyCode) == -1) {
      currencyCodes.push(currencyCode)
    }
  }

  for (var n in outputs) {
    const output = outputs[n]
    if (output.amount < 0) {
      res.json({err: "Error: negative output"})
      return
    }
    const currencyCode = output.currencyCode
    if (totalOutputs[currencyCode] == undefined) {
      totalOutputs[currencyCode] = 0
    }
    totalOutputs[currencyCode] += output.amount

    if (currencyCodes.indexOf(currencyCode) == -1) {
      currencyCodes.push(currencyCode)
    }
  }

  for (let n in currencyCodes) {
    const currencyCode = currencyCodes[n]
    if (totalOutputs[currencyCode] > totalInputs[currencyCode]) {
      res.json({err: "Error: Insufficient funds: " + currencyCode})
      return
    }
    if (currencyCode != PRIMARY_CURRENCY) {
      if (totalOutputs[currencyCode] != totalInputs[currencyCode]) {
        res.json({err: "Error: Inequal input/output for token: " + currencyCode})
        return
      }
    }
  }

  const networkFee = totalInputs[PRIMARY_CURRENCY] - totalOutputs[PRIMARY_CURRENCY]
  if (networkFee < MINIMUM_NETWORK_FEE) {
    res.json({err: "Error: insufficient network fee"})
    return
  }

  // Make sure all input addresses at least have sufficient funds
  var chkInputs = inputs.slice()
  checkInputs(chkInputs, function (err, response) {
    if (err) {
      res.json(err)
    } else {

      const txObj = new TxObj(inputs, outputs, networkFee)

      // Put the new transaction in the tx database
      db_transactions.insert(txObj, txObj.txid, function (err, response) {
        addBlockHeightToTransaction(txObj)

        if (err) {
          res.json(err)
        } else {
          // Update input addresses and output addresses with new balances and
          // Add txid to their lists
          var spInputs = inputs.slice()
          spendInputOutputs(spInputs, 1, txObj.txid, function (err, response) {
            if (err) {
              res.json(err)
            } else {
              var spOutputs = outputs.slice()
              spendInputOutputs(spOutputs, 0, txObj.txid, function (err, response) {
                if (err) {
                  res.json(err)
                } else {
                  res.json({ status: "Successful Spend", transaction: txObj })
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
  let amountString = ''
  let amountInt = 0
  let txObj = {}

  if (parts.length > 1) {
    amountString = parts[parts.length - 1]
    amountInt = parseInt(amountString)
  }

  // Insert the new address

  let txids = null
  if (amountInt > 0) {
    let inputs  = [ new InOutObj(PRIMARY_CURRENCY, 'coinbase_tx', amountInt) ]
    let outputs = [ new InOutObj(PRIMARY_CURRENCY, addr, amountInt) ]

    for (const n in TOKEN_CODES) {
      const code = TOKEN_CODES[n]
      inputs  =  inputs.concat([ new InOutObj(code, 'coinbase_tx', amountInt * (Number(n)+2)) ])
      outputs = outputs.concat([ new InOutObj(code, addr, amountInt * (Number(n)+2)) ])
    }

    txObj = new TxObj(inputs, outputs)
    txids = [ txObj.txid ]
  }
  const addressObj = new AddressObj(addr, amountInt, txids)

  db_addresses.insert(addressObj, addr, function (err, res) {
    if (err)
      cb(err)
    else if (amountInt > 0) {
      db_transactions.insert(txObj, txObj.txid, function (err, res) {
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
    const input = inputs[0]
    db_addresses.get(input.address, function (err, addressObj) {
      if (err) {
        cb(err)
      } else {
        if (addressObj.amounts[input.currencyCode] >= input.amount) {
          inputs.splice(0, 1)
          checkInputs(inputs, cb)
        } else {
          cb({error: "Insufficient [" + input.currencyCode + "] funds in address " + input.address})
        }
      }
    })
  }
}

function spendInputOutputs (inOuts, bIn, txid, cb) {
  if (inOuts.length == 0) {
    cb(null)
  } else {
    const inOut = inOuts[0]
    const currencyCode = inOut.currencyCode
    db_addresses.get(inOut.address, function (err, addressObj) {
      if (err) {
        cb(err)
      } else {
        var amt = inOut.amount
        if (bIn) {
          amt *= -1
        }
        addressObj.amounts[currencyCode] += amt
        if (addressObj.txids == undefined) {
          addressObj.txids = [txid]
        } else {
          if (addressObj.txids.indexOf(txid) == -1) {
            addressObj.txids.push(txid)
          }
        }

        db_addresses.insert(addressObj, inOut.address, function (err, res) {
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
