define([
  'chaplin',
  'controllers/base/controller',
  'models/base/model',
  'models/base/collection',
  'views/game-view',
  'views/webcamReminder-view',
  'views/guessHistory-view',
  'views/guessInput-view',
  'views/card-view',
  'views/queueCollection-view',
  'views/playerCollection-view',
], function(Chaplin, Controller, Model, Collection, GameView, WebCamView, GuessHistoryView, GuessInputView, CardView, QueueCollectionView, PlayerCollectionView){
  'use strict';

  var gameController = Controller.extend({

    wait : function(){
      socket.emit('join');
    },

    play : function(params){
      TB.setLogLevel(0);

      var api_key   = '44393472';
      var self      = this;
      var players   = new Collection();
      var queueCollection = new Collection();

      // View Handling
      this.view = new GameView({
        autoRender  : true,
        region      : 'main'
      });
      var webcamview = new WebCamView({
        autoRender  : true,
        region      : 'notifier'
      });
      var playersview = new PlayerCollectionView({
        autoRender  : true,
        region      : 'players',
        collection  : players
      });
      var guesshistoryview = new GuessHistoryView({
        autoRender  : true,
        region      : 'guessHistory'
      });
      var guessinputview = new GuessInputView({
        autoRender  : true,
        region      : 'guessInput'
      });

      // On page load
      socket.emit('info', function(data){
        console.log(data);

        // add the players
        if(data.players) players.add(data.players);
        // mark a player as the actor... maybe
        if(data.stage.player){
          var actor = players.findWhere({ id : data.stage.player.id });
          actor.set({ actor : true });
        }

        // Add players to the queue
        if(data.queue) queueCollection.add(data.queue);
      });

      guessinputview.on('guess', function (e) {
        socket.emit('guess', e.guess);
      });

      socket.on('bad_guess', function (e) {
        guesshistoryview.addHistory(e.guess);
        players.findWhere({ id: e.player.id }).trigger('bad_guess', e);
      });

      socket.on('correct_guess', function (e) {
        players.findWhere({ id: e.player.id }).trigger('correct_guess', e);
        players.findWhere({ id: e.stage.id }).trigger('acting_points', e);
      });

      this.subscribeEvent('joinQueue', function(){
        //guessinputview.disableInput();
        socket.emit('enqueue');
      });

      this.subscribeEvent('leaveQueue', function(){
        socket.emit('dequeue');
      });

      socket.on('start', function(data){
        console.log('start', data);
      });

      // Listen for stage chane events to update the actor attribute
      socket.on('stage_change', function(data){
        players.each(function(item){
          item.set({ 'actor' : false });
        });

        var player = players.findWhere({ id : data.player.id });
        player.set({ 'actor' : true });
      });

      var queueCollectionView = new QueueCollectionView({
          autoRender : true,
          collection : queueCollection,
          region     : 'actorQueue',
          session    : session,
          api_key    : api_key
      });

      socket.on('queue_updated', function(queue){
        queueCollection.reset();
        queueCollection.add(queue);
        queueCollectionView.renderAllItems();
      });

      socket.on('new_phrase', function(data){
        var cardModel = new Model(data);
        $('#cardHint').html('');
        var cardView  = new CardView({
          autoRender  : true,
          region      : 'card',
          model       : cardModel
        });
      });

      // Connect to opentok
      var session = TB.initSession(params.session_id);
      session.connect(api_key, params.token);

      // When connected, create self
      var vidOptions = {
        publishAudio  : false,
        publishVideo  : true,
        width         : 300,
        height        : 150
      };
      session.on('sessionConnected', function(e){
        var player = new Model({ 'id' : socket.socket.sessionid });
        players.add(player);
        var view = playersview.initItemView(player);
        var publisher = TB.initPublisher(api_key, 'uid_' + socket.socket.sessionid, vidOptions);

        session.publish(publisher);
        subscribeToStreams(e.streams);
      });

      // Listen for others to join
      session.on('streamCreated', function(e){
        webcamview.killReminder();
        subscribeToStreams(e.streams);
      });

      // Are players leaving?
      session.on('players', function(e){
        condole.log(e)
      });

      // Cool working code
      var subscribeToStreams = function(streams) {
        if (!session) return;

        for (var i = 0; i < streams.length; i++) {
          var stream = streams[i];
          if (stream.connection.connectionId != session.connection.connectionId) {
            var socketId = stream.connection.data.replace('socket_id:', '');

            var player = new Model({ 'id' : socketId });
            players.add(player);
            playersview.initItemView(player);

            session.subscribe(stream, 'uid_' + socketId);
          }
        }
      };

    }

  });

  return gameController;
});
