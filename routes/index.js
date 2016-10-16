var express = require('express');
var router = express.Router();
var async = require('async');

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var ObjectId = Schema.Types.ObjectId;
mongoose.connect('mongodb://localhost/medifact');

var DrugSchema = new Schema({name: {type: String, unique: true}, population: Number});
var CombSchema = new Schema({drugs: [{type: ObjectId, ref: 'Drug'}], symptom: Number});

var Drug = mongoose.model('Drug', DrugSchema);
var Comb = mongoose.model('Comb', CombSchema);

var THRESHOLD = 200;
var SYMPTOMS = [
  'Vomit with blood',
  'Productive cough with blood',
  'Diarrhea with blood or coffee-like stools',
  'Unproductive constipation with blood',
  'Green or yellow vomit',
  'Incontinence',
  'Foul breath',
  'Fruity, alcoholic breath',
  'Insomnia',
  'Other'
];

router.get('/($|check)', function (req, res, next) {
  res.render('check', {title: 'Medifact - Check Combinations', verb: 'will take'});
});

function calcVal(drugs, count, rows) {
  if (rows == 0) return 0;
  if (drugs.length == 3) {
    return calcVal([drugs[0], drugs[1]], count, rows) +
      calcVal([drugs[1], drugs[2]], count, rows) +
      calcVal([drugs[2], drugs[0]], count, rows) -
      count / ((drugs[0].population * drugs[1].population) +
      (drugs[1].population * drugs[2].population) +
      (drugs[2].population * drugs[0].population) -
      (drugs[0].population * drugs[1].population * drugs[2].population)) / rows;
  } else {
    var ratio = 1.0;
    drugs.forEach(function (drug) {
      ratio *= drug.population;
    });
    return count / (drugs[0].population * drugs[1].population) / rows;
  }
}

function compare(a, b) {
  return a.name > b.name
}

router.post('/($|check)', function (req, res, next) {
  Comb.count(function (err, rows) {
    if (err) return next(err);
    Drug.find({name: {$in: req.body.drugs}}, function (err, drugs) {
      if (err) return next(err);
      else {
        if (drugs.length != req.body.drugs.length) return next(new Error('No drug matches.'));
        Comb.count({drugs: drugs.sort(compare)}, function (err, count) {
          if (err) return next(err);
          else {
            var val = count < 1 ? -1 : calcVal(drugs, count, rows);
            var combination = req.body.drugs.join(' + ');
            drugs.forEach(function (drug, i) {
              drugs[i] = drug._id;
            });
            Comb.aggregate([
              {$match: {drugs: drugs.sort(compare)}},
              {$group: {_id: '$symptom', count: {$sum: 1}}}
            ], function (err, result) {
              if (err) return next(err);
              res.render('result', {
                title: 'Medifact - Check Combinations',
                val: val,
                THRESHOLD: THRESHOLD,
                combination: combination,
                symptoms: result,
                SYMPTOMS: SYMPTOMS,
                count: count
              });
            });
          }
        });
      }
    });
  });
});

function insertData(drugs, symptom, next) {
  var tasks = [];
  drugs.forEach(function (drug_name) {
    tasks.push(function (callback) {
      Drug.findOne({name: drug_name}, function (err, drug) {
        if (err) return callback(err);
        else {
          if (drug) {
            callback(null, drug);
          } else {
            new Drug({name: drug_name, population: Math.random() * (0.049) + 0.001}).save(function (err, drug) {
              callback(err, drug);
            });
          }
        }
      });
    });
  });
  async.series(tasks, function (err, results) {
    if (err) return next(err);
    else new Comb({drugs: results.sort(compare), symptom: symptom}).save(next);
  });
}

router.post('/report', function (req, res, next) {
  insertData(req.body.drugs, req.body.symptom, next);
});

router.all('/report', function (req, res, next) {
  res.render('report', {title: 'Medifact - Report Symptoms', SYMPTOMS: SYMPTOMS, verb: 'took'});
});

router.get('/fake', function (req, res, next) {
  var tasks = [];
  for (var i = 0; i < 1000; i++) {
    tasks.push(function (callback) {
      var num = Math.random() < 0.5 ? 3 : 2;
      var drugs = [];
      var symptom = (Math.random() * 10) | 0;
      var used = [];
      for (var j = 0; j < num; j++) {
        var rand;
        do {
          rand = (Math.random() * 26) | 0;
        } while (~used.indexOf(rand));
        used.push(rand);
        drugs.push('Drug ' + String.fromCharCode(rand + 65));
      }
      insertData(drugs, symptom, callback);
    });
  }
  async.series(tasks, function (err) {
    if (err) next(err);
    else res.redirect('/stat');
  })
});

router.get('/stat', function (req, res, next) {
  Comb.count(function (err, rows) {
    if (err) return next(err);
    Comb.aggregate([
      {
        $group: {
          _id: '$drugs',
          count: {$sum: 1}
        }
      }
    ], function (err, result) {
      if (err) return next(err);
      else {
        Drug.populate(result, {path: '_id'}, function (err, result) {
          var dataPoints = [];
          result.forEach(function (datum) {
            var names = [];
            datum._id.forEach(function (drug) {
              names.push(drug.name);
            });
            var val = datum.count < 1 ? -1 : calcVal(datum._id, datum.count, rows);
            if (val > THRESHOLD) {
              dataPoints.push({
                y: (val / THRESHOLD * 100).toFixed(2),
                legendText: names.join(' + '),
                label: names.join(' + ')
              });
            }
          });
          res.render('stat', {title: 'Medifact - Statistics', dataPoints: dataPoints});
        });
      }
    });
  });
});

module.exports = router;
