module.exports = function (RAF, Cache) {
  var Stream = require('./stream')
  var Append = require('./append')
  var frame = require('./frame')

  var DO_CACHE = true

  function id(e) { return e }
  var _codec = {encode: id, decode: id, buffer: true}
  return function (file, opts) {
    var cache = new Cache(1024)
    var raf = RAF(file)
    var closed = false
    var block = opts && opts.block || 65536
    var length = null, waiting = [], waitingDrain = [], self, state
    var codec = opts && opts.codec || _codec
    var since = {value: undefined}
    function onError(err) {
      if(self.onError) self.onError(err)
      else throw err
    }

    raf.stat(function (_, stat) {
      var len = stat ? stat.size : 0
      self.length = length = len
      if(len%block == 0) {
        self.appendState = state = Append.initialize(block, length, Buffer.alloc(block))
        while(waiting.length) waiting.shift()()
        self.onWrite(self.length)
      } else {
        var start = len - len%block
        raf.read(len - len%block, Math.min(block, len%block), function (err, _buffer) {
          if(err) return onError(err)
          //raf always gives us the last block the actual size
          //so copy it to a full size block.
          var buffer = Buffer.alloc(block)
          _buffer.copy(buffer)
          self.appendState = state = Append.initialize(block, length, buffer)
          var offset = frame.getPreviousRecord(block, buffer, length)
          self.onWrite(offset)
          while(waiting.length) waiting.shift()()
        })
      }
    })

    function onLoad (fn) {
      return function (offset, cb) {
        if(closed) return cb(new Error('closed'))
        if(length === null) waiting.push(function () { fn(offset, cb) })
        else return fn(offset, cb)
      }
    }

    // the cache slows things down a surprising amount!
    // an entire scan in 1.76 seconds, vs > 2.5 seconds.
    var last_index = -1, last_buffer
    var blocks = cache; //new WeakMap()

    function getBlock (i,  cb) {
      if(i === last_index)
        return cb(null, last_buffer)
      if(DO_CACHE && blocks.get(i))
        return cb(null, blocks.get(i))

      var file_start = i*block
      //insert cache here...

      if(file_start == state.start)
        return cb(null, state.buffers[0])

      raf.read(file_start, Math.min(block, length-file_start), function (err, buffer) {
        if(err) return setTimeout(function () {
          getBlock(i, cb)
        }, 200)
        if(DO_CACHE) blocks.set(i, buffer)
        last_index = i; last_buffer = buffer;
        cb(err, buffer)
      })
    }

    function callback(cb, buffer, start, length, offset) {
      cb(null,
        //I did consider just returning the whole buffer + start + length,
        //then let the reader treat that as pointers, but it didn't
        //actually measure to be faster.
        codec.decode(buffer.slice(start, start+length)),
        start,
        length,
        offset
      )
    }
    function getPrevious (offset, cb) {
      var block_start = offset%block
      var file_start = offset - block_start
      if(block_start === 0) {
        file_start = file_start - block //read the previous block!
        getBlock(~~(offset/block)-1, function (err, buffer) {
          block_start = buffer.readUInt32LE(block-4)
          var length = buffer.readUInt16LE(block_start-2)
          callback(cb, buffer, block_start-2-length, length, offset)
        })
      }
      else {
        getBlock(~~(offset/block), function (err, buffer) {
          var length = buffer.readUInt16LE(block_start-2)
          callback(cb, buffer, block_start-2-length, length, offset)
        })
      }
    }
    function get (offset, cb) {
      //read the whole block
      if(offset >= length) return cb()
      var block_start = offset%block
      var file_start = offset - block_start
      getBlock(~~(offset/block), function (err, buffer) {
        if(err) return cb(err)
        var length = buffer.readUInt16LE(block_start)
        //if this is last item in block, jump to start of next block.
        if(length === block-1) //wouldn't zero be better?
          get(file_start+block, cb)
        else
          callback(cb, buffer, block_start+2, length, offset)
      })
    }

    var write_timer
    var w = 0
    function next_write () {
      state = Append.writable(state)
      var buffer = Append.getWritable(state)
      raf.write(state.written, buffer, function (err, v) {
        if(err) throw err
        var w = state.written
        state = Append.written(state)
        //waitingDrain moved from schedule_next_write
        while(waitingDrain.length)
          waitingDrain.shift()()

        return schedule_next_write()
      })
    }

    function schedule_next_write () {
      if(Append.isWriting(state)) return
      if(Append.hasWholeWrite(state)) {
        clearTimeout(write_timer)
        next_write()
      } else if(Append.hasWrite(state)) {
        clearTimeout(write_timer)
        write_timer = setTimeout(next_write, 20)
      } else {
        //TODO: some views could be eager, updating before the log is fully persisted
        //      just don't write the view data until the log is confirmed.
        if(self.streams.length) {
          for(var i = 0; i < self.streams.length; i++)
            if(!self.streams[i].ended)
              self.streams[i].resume()
        }
        //waiting was draining when it was ready to queue more
        //appends, but thought it would be better if it was
        //happened after it definitely is written.
        //maybe there should be a way to wait for both?
//        while(waitingDrain.length)
//          waitingDrain.shift()()
      }
    }

    function _append(data) {
      data = codec.encode(data)
      if('string' == typeof data)
        data = Buffer.from(data)
      //we want to track the pointer to the latest block added,
      //so set value before state is updated.
      since.value = state.offset
      state = Append.append(state, data)
    }

    function append(data, sync, cb) {
      if('function' === typeof sync)
        cb = sync, sync = false

      if(Array.isArray(data)) {
        for(var i = 0; i < data.length; i++)
          _append(data[i])
      } else
        _append(data)

      self.length = length = state.offset
      var offset = since.value
      schedule_next_write()
      self.onWrite(offset)
      if(sync)
        self.onDrain(function () {
          cb(null, since.value)
        })
      else
        cb(null, offset)
    }

    return self = {
      filename: file,
      block: block,
      length: null,
      appendState: state,
      codec: codec,
      getBlock: onLoad(getBlock),
      get: onLoad(get),
      since: since,
      getPrevious: onLoad(getPrevious),

      onReady: function (fn) {
        if(this.length != null) return fn()
        waiting.push(fn)
      },

      append: onLoad(append),

      stream: function (opts) {
        var stream = new Stream(this, opts)
        if(opts && opts.live)
          this.streams.push(stream)
        return stream
      },

      streams: [],

      onWrite: function () {},

      onDrain: onLoad(function (fn) {
        if(!Append.hasWrite(state)) fn()
        else waitingDrain.push(fn)
      }),

      close: function (cb) {
        self.onDrain(function () {
          console.log('drained', state)
          closed = true
          raf.close(function () {
            cb()
          })
        })
      }
    }
  }
}

