var tape = require('tape')
var fs = require('fs')
var Offset = require('../')

var v1 = Buffer.from('hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world hello world')
var v2 = Buffer.from('hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db hello offset db')
var v3 = Buffer.from('hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db hello offsetty db')

tape('simple', function (t) {
  var file = '/tmp/fao-test_del.log'
  try { fs.unlinkSync(file) } catch (_) {}
  var db = Offset(file, {block: 2*1024})

  db.append(v1, function (err, offset1) {
    if(err) throw err
    t.equal(offset1, db.since.value)
    t.equal(db.since.value, 0)
    db.append(v2, function (err, offset2) {
      if(err) throw err
      db.append(v3, function (err, offset3) {
        if(err) throw err
        t.ok(offset3 > offset2)
        t.equal(offset3, db.since.value)
        db.get(offset1, function (err, b) {
          if(err) throw err
          t.equal(b.toString(), v1.toString())

          db.get(offset2, function (err, b2) {
            if(err) throw err
            t.equal(b2.toString(), v2.toString())

            db.get(offset3, function (err, b3) {
              if(err) throw err
              t.equal(b3.toString(), v3.toString())

              db.del(offset2, function (err) {
                t.error(err)

                db.get(offset2, function (err, bdel) {
                  t.ok(err)
                  t.equal(err.message, 'item has been deleted')
                  t.end()
                })
              })
            })
          })
        })
      })
    })
  })
})

tape('simple reread', function (t) {
  var file = '/tmp/fao-test_del.log'
  var db = Offset(file, {block: 2*1024})

  db.get(0, function (err, b) {
    if(err) throw err
    t.equal(b.toString(), v1.toString())

    db.get(v1.length+2+2, function (err, b2) {
      t.ok(err)
      t.equal(err.message, 'item has been deleted')

      db.get(v1.length+2+2+v2.length+2+2, function (err, b3) {
        if(err) throw err
        t.equal(b3.toString(), v3.toString())

        t.end()
      })
    })
  })
})

function collect (cb) {
  return {
    array: [],
    paused: false,
    write: function (v) { this.array.push(v) },
    end: function (err) {
      this.ended = err || true
      cb(err, this.array)
    }
  }
}

tape('stream delete', function(t) {
  var file = '/tmp/offset-test_'+Date.now()+'.log'
  var db = Offset(file, {block: 64*1024})

  var b2 = Buffer.from('hello offset db')
  
  db.append(Buffer.from('hello world'), function (err, offset1) {
    if(err) throw err
    db.append(b2, function (err, offset2) {
      if(err) throw err
      db.del(offset1, function (err) {
        t.error(err)
        db.stream({seqs: false}).pipe(collect(function (err, ary) {
          t.notOk(err)
          t.deepEqual(ary, [b2])
          db.onDrain(t.end)
        }))
      })
    })
  })
})
