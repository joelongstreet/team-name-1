define([
  'chaplin',
  'controllers/base/controller',
  'views/game-view',
  'views/webcamReminder-view'
], function(Chaplin, Controller, GameView, WebCamView){
  'use strict';

  var gameController = Controller.extend({

    play : function(){
      var webcamview = new WebCamView({
        autoRender  : true,
        region      : 'notifier'
      });
      
      this.view = new GameView({
        autoRender  : true,
        region      : 'main'
      });
    },

  });

  return gameController;
})