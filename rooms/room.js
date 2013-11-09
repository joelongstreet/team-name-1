var opentok = require('../opentok');
var _ = require('underscore');
var PhraseStore = require('./phrase_store');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var TIME_stage = 2 * 60 * 1000;
var CHECK_QUEUE_INTERVAL = 300;
var PHRASE_DURATION = 10 * 1000;
var PHRASE_LIMIT = 3;
var phrase_store = new PhraseStore();

var are_same = function (player1, player2) {
    
    if (!player1 && !player2)
        return true;

    if (player1 && player2) 
        return player1.id = player2.id;

    return false;
};

var log = function (message) {
    console.log(message);
};

var normalize_string = function (val) {
    return (val || "").trim().toLowerCase().split(/\s+/).join('');
};

var make_guessable_string = function (val, percent) {
    var result = "";
    
    var replace_at = function (s, index, character) {
        return s.substr(0, index) + character + s.substr(index + character.length);
    };
    var get_random = function (max) {
        return Math.floor(Math.random() * max);
    };
    var replaced = _(val.split(/\s+/)).map(function (p) {
        var replace_random = function (s) {
            var char_replaced = "_";
            
            do {
                var i = get_random(s.length);
            } while (s[i] != "_");


            return replace_at(s, i, "_");
        };

        var replacement_count = Math.floor(percent * p.length);

        for (var i = 0; i < replacement_count.length; i++) {
            p = replace_random(p);
        }
        return p;
    });

    return replaced.join(" ");
};

var get_phrase = function (history) {
    return phrase_store.get_phrase(history);
};

function Game (max_size, name) {
    this.name = name;
    this.max_size = max_size;
    this.players = [];
    this.stage = { player: null, time: null };
    this.phrase_history = [];
    this.current_phrase = null;
    this.is_started = true;
    this.queue = [];
}

util.inherits(Game, EventEmitter);

Game.prototype.has_space = function () {
    return this.players.length <= this.max_size;;
};

Game.prototype.add_player = function (player) {
    if (this.has_player(player)) 
        return;
    
    player.score = 0;

    var game = this;

    this.players.push(player);

    player.on('guess', (function (guess) {
        if (!this.check_guess(guess)) {
            this.message_players('bad_guess', { player: player, guess: guess });
        }
        else {
            this.message_players('correct_guess', { player: player, guess: guess });  
            player.score += this.current_phrase.value;
            this.complete_phrase();
        }
    }).bind(this));

    player.on('enqueue', function () {
        if (!_(game.queue).contains(player)) {
            game.queue.push(player);
            game.message_players('queue_updated', game.queue);
        }
    });

    player.on('dequeue', function () {
        if (_(game.queue).contains(player)) {    
            game.queue = _(game.queue).reject(function (e) { return are_same(e, player); });
            game.message_players('queue_updated', game.queue);
        }
    });

    this.emit('player_joined', player);

    this.message_players('players', this.players);

    if (this.players.length == 2) {
        this.start();
    }
};

Game.prototype.remove_player = function (player) {
    if (!this.has_player(player)) return;

    var is_on_stage = are_same(this.stage.player, player);

    if (is_on_stage) {
        this.clear_stage();
    }

    this.players = _(this.players).reject(function (e) { return e.id == player.id; });
    
    player.off('guess');
    player.off('enqueue');
    player.off('dequeue');
    
    this.message_players('players', this.players);
    
    if (this.players.length < 2) {
        this.end();
    }
};

Game.prototype.check_guess = function (guess) {
    return (normalize_string(guess) === this.current_phrase.normalized);
};

Game.prototype.message_players = function (message, args, extra) {
    extra = extra || function (p, obj) { return obj; };

    this.players.forEach(function (p) {
        p.emit(message, extra(p, args));
    });
};

Game.prototype.next_phrase = function () {
    clearTimeout(this.phrase_timeout);
    var p = get_phrase(this.phrase_history);
    var game = this;
    this.phrase_history.push(p);

    var parts = p.phrase.toLowerCase().split(/\s+/);
    
    this.current_phrase = {
        //these are private
        parts: parts,
        normalized: normalize_string(p.phrase),
        phrase: p,
        //these are public
        set_on: new Date().getTime(),
        hint: make_guessable_string(p.phrase),
        word_counts: _(parts).map(function (p) { return p.length; }),
        value: 1,
        duration: PHRASE_DURATION
    };

    this.message_players('new_phrase', {
        word_counts: this.current_phrase.word_counts,
        set_on: this.current_phrase.set_on,
        value: this.current_phrase.value,
        duration: this.current_phrase.duration,
        hint: this.current_phrase.hint
    }, function (player, obj) {
        if (are_same(player, game.stage.player)) {
            obj = _.clone(obj);
            obj.phrase = p.phrase;
        }
        return obj;
    });
    
    

    this.phrase_timeout = setTimeout((function () {
        this.complete_phrase();
    }).bind(this),  this.current_phrase.duration);
};

Game.prototype.set_stage = function (p) {
    if (are_same(this.stage.player, p)) return;

    this.stage.completed_phrases = 0;
    this.stage.player = p;
    this.stage.time = new Date().getTime();
    this.message_players('stage_change', this.stage);
};

Game.prototype.complete_phrase = function () {
    this.stage.completed_phrases++;
    this.message_players('phrase_complete', this.players);

    var reached_limit = this.stage.completed_phrases >= PHRASE_LIMIT ;
    var others_waiting = this.queue.length > 0;

    if (reached_limit && others_waiting) {
        // allow next queue entry to start phrase 
        return;
    }

    this.next_phrase();
};

Game.prototype.clear_stage = function () {
    clearInterval(this.phrase_timeout);
    this.stage.completed_phrases = 0;
    this.stage.player = null;
    this.stage.time = null;
    this.message_players('stage_clear');
};

Game.prototype.start = function () {
    clearInterval(this.queue_handle);
    this.is_started = true;

    this.queue_handle = setInterval((function () {
        if (!this.is_started) return;

        if (this.queue.length > 0) {
            // If there's nobody on stage OR the player has been on stage long enough
            // This COULD boot somebody in the middle of a phrase for now
            if (!this.stage.player || this.stage.completed_phrases >= PHRASE_LIMIT) {
                this.clear_stage();
                this.set_stage(this.queue.shift());
                this.next_phrase();
            }
        }
    }).bind(this), CHECK_QUEUE_INTERVAL);

    this.message_players('start', this.players);
    this.emit('start');
};

Game.prototype.end = function () {
    clearInterval(this.queue_handle);
    clearTimeout(this.phrase_timeout);

    this.is_started = false;
    this.clear_stage();
    this.queue = [];
    this.message_players('end', this.players);
    this.emit('end');
};

Game.prototype.has_player = function (m) {
    return _.chain(this.players).pluck('id').contains(m.id).value();
};

Game.prototype.set_session_id = function (session_id) {
    this.session_id = session_id;
    this.emit('session_joined');
};

Game.prototype.info = function () {
    return {
        player_count: this.players.length,
        session_id: this.session_id
    }
};

module.exports = Game;