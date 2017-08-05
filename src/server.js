// server.js
// @flow
// BASE SETUP
// =============================================================================

import express from 'express'        // call express
import bodyParser from 'body-parser'
import random from 'random-js'
import cors from 'cors'
import { bns } from 'biggystring'

const GENESIS_BLOCK_TIME = 1491004800
const BLOCK_TIME_SECONDS = 60
const MINIMUM_NETWORK_FEE = '20000'
const PRIMARY_CURRENCY = 'TRD'
const TOKEN_CODES = ['ANA', 'DOGESHIT', 'CRAP']

// call the packages we need
const app = express()                 // define our app using express

// configure app to use bodyParser()
// this will let us get the data from a POST
app.use(bodyParser.urlencoded({ extended: true }))
app.use(bodyParser.json())
app.use(cors())

const port = process.env.PORT || 8080        // set our port

// Nano for CouchDB
// =============================================================================
const nano = require('nano')('http://shitcoin:kids_in_pool@localhost:5984')
let dbTransactions
let dbAddresses
let init = false

if (!init) {
  nano.db.destroy('db_transactions', function (err, body, header) {
    if (err) { console.log('Non-critical error. No tx database') }
    nano.db.destroy('db_addresses', function (err, body, header) {
      if (err) { console.log('Non-critical error. No addr database') }
      nano.db.create('db_transactions', function (err, body, header) {
        if (err) { return err }
        dbTransactions = nano.db.use('db_transactions')
        nano.db.create('db_addresses', function (err, body, header) {
          if (err) { return err }
          dbAddresses = nano.db.use('db_addresses')
        })
      })
    })
  })
} else {
  dbTransactions = nano.db.use('db_transactions')
  dbAddresses = nano.db.use('db_addresses')
}

init = true
// BASE CLASSES
// =============================================================================

class InOutObj {
  currencyCode:string
  address:string
  amount:string
  constructor (currencyCode:string, address:string, amount:string) {
    this.currencyCode = currencyCode
    this.address = address
    this.amount = amount
  }
}

class TxObj {
  txid:string
  networkFee:string
  inputs:Array<InOutObj>
  outputs:Array<InOutObj>
  txDate:number
  blockHeight:string
  constructor (inputs:Array<InOutObj>, outputs:Array<InOutObj>, networkFee = '0', blockHeight = '0') {
    const r = random()
    this.txid = r.hex(24)
    this.networkFee = networkFee
    this.inputs = inputs
    this.outputs = outputs
    this.txDate = Date.now() / 1000
    this.blockHeight = blockHeight
  }
}

class AddressObj {
  address:string
  amounts:any
  txids:Array<string>|null
  constructor (address:string, trdAmount:string, txids:Array<string>|null) {
    this.address = address
    this.amounts = {}
    this.amounts[PRIMARY_CURRENCY] = trdAmount
    this.txids = txids

    if (txids) {
      let n = 1
      for (let code of TOKEN_CODES) {
        this.amounts[code] = bns.mul(trdAmount, n.toString())
        n++
      }
    }
  }
}

// ROUTES FOR OUR API
// =============================================================================
const router = express.Router()              // get an instance of the express Router

// middleware to use for all requests
router.use(function (req, res, next) {
    // do logging
  if (!init) {
    res.json(new Error('Initializing...'))
  } else {
    console.log('Something is happening.')
    next() // make sure we go to the next routes and don't stop here
  }
})

router.get('/address/:address_id', function (req, res) {
  console.log('API /address/' + req.params.address_id)
  dbAddresses.get(req.params.address_id, function (err, addressObj) {
    if (err) {
      if (err.error === 'not_found') {
        // Create address with default funds
        createAddress(req.params.address_id, function (err, addressObj2) {
          if (err) {
            res.json(err)
          } else {
            res.json(addressObj2)
          }
        })
      } else {
        res.json(err)
      }
    } else {
      res.json(addressObj)
    }
  })
})

function getBlockHeight (unixTimeSeconds:number):string {
  // 60s blocks starting at Jan 1 2017 GMT
  let numBlocks = (unixTimeSeconds - GENESIS_BLOCK_TIME) / BLOCK_TIME_SECONDS
  numBlocks = Math.floor(numBlocks)
  return numBlocks.toString()
}

function addBlockHeightToTransaction (txObj:TxObj) {
  let txHeight:string = bns.add(getBlockHeight(txObj.txDate), '3')

  const now = Date.now() / 1000
  const blockHeight:string = getBlockHeight(now)

  const heightDiff:string = bns.sub(blockHeight, txHeight)
  if (bns.lt(heightDiff, '0')) {
    txHeight = '0'
  }
  txObj.blockHeight = txHeight
}

router.get('/transaction/:tx_id', function (req, res) {
  console.log('API /transaction/' + req.params.tx_id)
  dbTransactions.get(req.params.tx_id, function (err, response) {
    if (err) {
      res.json(err)
    } else {
      addBlockHeightToTransaction(response)
      res.json(response)
    }
  })
})

router.get('/height', function (req, res) {
  console.log('API /height/')
  const d = Date.now() / 1000
  const response = {
    height: getBlockHeight(d)
  }
  res.json(response)
})

router.post('/add_token', function (req, res) {
  const currencyCode:string = req.body.currencyCode
  const address:string = req.body.address
  const amount:string = req.body.amount

  // Create Tx that spends from coinbase_tx to address with currencyCode
  const input:InOutObj = new InOutObj(currencyCode, 'coinbase_tx', amount)
  const output:InOutObj = new InOutObj(currencyCode, address, amount)
  const txObj:TxObj = new TxObj([input], [output])

  // Get addressObj from DB
  dbAddresses.get(address, function (err, addressObj:AddressObj) {
    if (err) {
      res.json(err)
      return
    }
    // Add txid and new amount to addressObj
    if (
      typeof addressObj.txids === 'undefined' ||
      addressObj.txids === null
    ) {
      addressObj.txids = []
    }
    addressObj.txids.push(txObj.txid)
    if (typeof addressObj.amounts[currencyCode] === 'undefined') {
      addressObj.amounts[currencyCode] = '0'
    }
    const tempVal = addressObj.amounts[currencyCode]
    addressObj.amounts[currencyCode] = bns.add(tempVal, amount)

    // Update addressObj and create new tx in db
    dbAddresses.insert(addressObj, addressObj.address, function (err, response1) {
      if (err) {
        res.json(err)
      } else {
        dbTransactions.insert(txObj, txObj.txid, function (err, response2) {
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

router.post('/spend', function (req, res) {
  let inputs = req.body.inputs
  let outputs = req.body.outputs

  // Make sure all inputs are >= outputs
  let totalInputs = {}
  totalInputs[PRIMARY_CURRENCY] = '0'
  let totalOutputs = {}
  totalOutputs[PRIMARY_CURRENCY] = '0'
  let currencyCodes = [ PRIMARY_CURRENCY ]

  for (const input of inputs) {
    if (bns.lt(input.amount, '0')) {
      res.json({err: 'Error: negative input'})
      return
    }
    const currencyCode = input.currencyCode
    if (totalInputs[currencyCode] === undefined) {
      totalInputs[currencyCode] = '0'
    }
    totalInputs[currencyCode] = bns.add(totalInputs[currencyCode], input.amount)

    if (currencyCodes.indexOf(currencyCode) === -1) {
      currencyCodes.push(currencyCode)
    }
  }

  for (let output of outputs) {
    if (bns.lt(output.amount, '0')) {
      res.json({err: 'Error: negative output'})
      return
    }
    const currencyCode = output.currencyCode
    if (totalOutputs[currencyCode] === undefined) {
      totalOutputs[currencyCode] = '0'
    }
    totalOutputs[currencyCode] = bns.add(totalOutputs[currencyCode], output.amount)

    if (currencyCodes.indexOf(currencyCode) === -1) {
      currencyCodes.push(currencyCode)
    }
  }

  for (let currencyCode of currencyCodes) {
    if (bns.gt(totalOutputs[currencyCode], totalInputs[currencyCode])) {
      res.json({err: 'Error: Insufficient funds: ' + currencyCode})
      return
    }
    if (currencyCode !== PRIMARY_CURRENCY) {
      if (totalOutputs[currencyCode] !== totalInputs[currencyCode]) {
        res.json({err: 'Error: Inequal input/output for token: ' + currencyCode})
        return
      }
    }
  }

  const networkFee:string = bns.sub(totalInputs[PRIMARY_CURRENCY], totalOutputs[PRIMARY_CURRENCY])
  if (bns.lt(networkFee, MINIMUM_NETWORK_FEE)) {
    res.json({err: 'Error: insufficient network fee'})
    return
  }

  // Make sure all input addresses at least have sufficient funds
  const chkInputs = inputs.slice()
  checkInputs(chkInputs, function (err, response) {
    if (err) {
      res.json(err)
    } else {
      const txObj = new TxObj(inputs, outputs, networkFee)

      // Put the new transaction in the tx database
      dbTransactions.insert(txObj, txObj.txid, function (err, response) {
        addBlockHeightToTransaction(txObj)

        if (err) {
          res.json(err)
        } else {
          // Update input addresses and output addresses with new balances and
          // Add txid to their lists
          const spInputs = inputs.slice()
          spendInputOutputs(spInputs, 1, txObj.txid, function (err, response) {
            if (err) {
              res.json(err)
            } else {
              const spOutputs = outputs.slice()
              spendInputOutputs(spOutputs, 0, txObj.txid, function (err, response) {
                if (err) {
                  res.json(err)
                } else {
                  res.json({ status: 'Successful Spend', transaction: txObj })
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
app.use('/api', router)

// START THE SERVER
// =============================================================================
app.listen(port)
console.log('Magic happens on port ' + port)

function createAddress (addr, cb) {
  // Parse out the last part of address after "__"
  const parts = addr.split('__')
  let nativeAmount = '0'
  let txObj = {}

  if (parts.length > 1) {
    nativeAmount = parts[parts.length - 1]
  }

  // Insert the new address

  let txids = null
  if (bns.gt(nativeAmount, '0')) {
    let inputs = [ new InOutObj(PRIMARY_CURRENCY, 'coinbase_tx', nativeAmount) ]
    let outputs = [ new InOutObj(PRIMARY_CURRENCY, addr, nativeAmount) ]
    let n = 1
    for (let currencyCode of TOKEN_CODES) {
      const amt = bns.mul(nativeAmount, n.toString())
      inputs = inputs.concat([ new InOutObj(currencyCode, 'coinbase_tx', amt) ])
      outputs = outputs.concat([ new InOutObj(currencyCode, addr, amt) ])
      n++
    }

    txObj = new TxObj(inputs, outputs)
    txids = [ txObj.txid ]
  }
  const addressObj = new AddressObj(addr, nativeAmount, txids)

  dbAddresses.insert(addressObj, addr, function (err, res) {
    if (err) {
      cb(err)
    } else if (bns.gt(nativeAmount, '0')) {
      dbTransactions.insert(txObj, txObj.txid, function (err, res) {
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
  if (inputs.length === 0) {
    cb(null, true)
  } else {
    const input = inputs[0]
    dbAddresses.get(input.address, function (err, addressObj) {
      if (err) {
        cb(err)
      } else {
        if (bns.gte(addressObj.amounts[input.currencyCode], input.amount)) {
          inputs.splice(0, 1)
          checkInputs(inputs, cb)
        } else {
          cb(new Error('Insufficient [' + input.currencyCode + '] funds in address ' + input.address))
        }
      }
    })
  }
}

function spendInputOutputs (inOuts, bIn, txid, cb) {
  if (inOuts.length === 0) {
    cb(null)
  } else {
    const inOut = inOuts[0]
    const currencyCode = inOut.currencyCode
    dbAddresses.get(inOut.address, function (err, addressObj) {
      if (err) {
        cb(err)
      } else {
        let amt:string = inOut.amount
        if (bIn) {
          amt = bns.mul(amt, '-1')
        }
        const tempVal = addressObj.amounts[currencyCode]
        addressObj.amounts[currencyCode] = bns.add(tempVal, amt)
        if (
          typeof addressObj.txids === 'undefined' ||
          addressObj.txids === null
        ) {
          addressObj.txids = [txid]
        } else {
          if (addressObj.txids.indexOf(txid) === -1) {
            addressObj.txids.push(txid)
          }
        }

        dbAddresses.insert(addressObj, inOut.address, function (err, res) {
          if (err) {
            cb(err)
          } else {
            inOuts.splice(0, 1)
            spendInputOutputs(inOuts, bIn, txid, cb)
          }
        })
      }
    })
  }
}
