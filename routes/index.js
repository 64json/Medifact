var express = require('express');
var router = express.Router();
var async = require('async');
var _ = require('underscore');

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var ObjectId = Schema.Types.ObjectId;
mongoose.connect('mongodb://localhost/medifact');

var DrugSchema = new Schema({name: {type: String, unique: true}, population: Number});
var CombSchema = new Schema({
  drugs: [{type: ObjectId, ref: 'Drug'}],
  symptom: Number,
  age: Number,
  gender: Number,
  race: Number
});

var Drug = mongoose.model('Drug', DrugSchema);
var Comb = mongoose.model('Comb', CombSchema);

var THRESHOLD = process.env.MED_THRESHOLD || 100;
var SYMPTOMS = [
  'Vomit with blood',
  'Productive cough with blood',
  'Diarrhea with blood or coffee-like stools',
  'Unproductive constipation with blood',
  'Green or yellow vomit',
  'Incontinence',
  'Foul breath',
  'Fruity, alcoholic breath',
  'Insomnia'
];
var AGE = [];
for (var i = 0; i < 100; i++) AGE.push(i);
var GENDERS = ['Female', 'Male', 'Other'];
var RACES = ['White', 'Asian', 'Black'];
var DRUGS = [];
for (var i = 0; i < 26; i++) DRUGS.push('Drug ' + String.fromCharCode(65 + i))

router.get('/profile', function (req, res, next) {
  res.render('profile', {title: 'Medifact - Profile Setting', AGE: AGE, GENDERS: GENDERS, RACES: RACES});
});

router.get('*', function (req, res, next) {
  if ('age' in req.cookies && 'gender' in req.cookies && 'race' in req.cookies) return next();
  res.redirect('/profile');
});

router.get('/($|check)', function (req, res, next) {
  res.render('check', {title: 'Medifact - Check Combinations', verb: 'will take', DRUGS: DRUGS});
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
  return a.name > b.name ? 1 : -1;
}

router.post('/($|check)', function (req, res, next) {
  var condition = getCondition(req);
  Comb.count(condition, function (err, rows) {
    if (err) return next(err);
    if (!req.body.drugs || req.body.drugs.length < 2) return next(new Error('No Drug Matches.'));
    Drug.find({name: {$in: req.body.drugs}}, function (err, drugs) {
      if (err) return next(err);
      else {
        if (drugs.length != req.body.drugs.length) return next(new Error('No Drug Matches.'));
        Comb.count(_.extend({drugs: drugs.sort(compare)}, condition), function (err, count) {
          if (err) return next(err);
          else {
            var val = rows < 3 ? -1 : calcVal(drugs, count, rows);
            var combination = req.body.drugs.join(' + ');
            drugs.forEach(function (drug, i) {
              drugs[i] = drug._id;
            });
            async.parallel({
              occurences: function (callback) {
                Comb.count({drugs: drugs.sort(compare)}, callback);
              },
              symptoms: function (callback) {
                Comb.aggregate([
                  {$match: {drugs: drugs.sort(compare)}},
                  {$group: {_id: '$symptom', count: {$sum: 1}}},
                  {$sort: {count: -1}}
                ], callback);
              },
              ages: function (callback) {
                Comb.aggregate([
                  {$match: {drugs: drugs.sort(compare)}},
                  {$group: {_id: '$age', count: {$sum: 1}}},
                  {$sort: {count: -1}}
                ], callback);
              },
              genders: function (callback) {
                Comb.aggregate([
                  {$match: {drugs: drugs.sort(compare)}},
                  {$group: {_id: '$gender', count: {$sum: 1}}},
                  {$sort: {count: -1}}
                ], callback);
              },
              races: function (callback) {
                Comb.aggregate([
                  {$match: {drugs: drugs.sort(compare)}},
                  {$group: {_id: '$race', count: {$sum: 1}}},
                  {$sort: {count: -1}}
                ], callback);
              }
            }, function (err, result) {
              res.render('result', {
                title: 'Medifact - Check Combinations',
                val: val,
                THRESHOLD: THRESHOLD,
                combination: combination,
                symptoms: result.symptoms,
                genders: result.genders,
                ages: result.ages,
                races: result.races,
                occurrences: result.occurences,
                SYMPTOMS: SYMPTOMS,
                GENDERS: GENDERS,
                RACES: RACES,
                age_group: (req.cookies.age / 10) | 0,
                gender_group: req.cookies.gender,
                race_group: req.cookies.race
              });
            });
          }
        });
      }
    });
  });
});

function insertData(drugs, symptom, age, gender, race, next) {
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
    else new Comb({
      drugs: results.sort(compare),
      symptom: symptom,
      age: (age / 10) | 0,
      gender: gender,
      race: race
    }).save(next);
  });
}

router.post('/report', function (req, res, next) {
  if (!req.body.drugs || req.body.drugs.length < 2
    || _.uniq(req.body.drugs).length < req.body.drugs.length) return next(new Error('Invalid Drug.'));
  if (!req.body.symptom) return next(new Error('Invalid Symptom.'));
  insertData(req.body.drugs, req.body.symptom, req.cookies.age, req.cookies.gender, req.cookies.race, function (err) {
    if (err) return next(err);
    res.redirect('/stat');
  });
});

router.get('/report', function (req, res, next) {
  res.render('report', {
    title: 'Medifact - Report Symptoms',
    SYMPTOMS: SYMPTOMS,
    verb: 'took',
    report: true,
    DRUGS: DRUGS
  });
});

router.get('/clear', function (req, res, next) {
  async.parallel([
    function (callback) {
      Drug.remove({}, callback);
    },
    function (callback) {
      Comb.remove({}, callback);
    }
  ], function (err) {
    if (err) return next(err);
    res.redirect('/stat');
  });
});

router.get('/fake', function (req, res, next) {
  var tasks = [];
  for (var i = 0; i < 1000; i++) {
    tasks.push(function (callback) {
      var num = Math.random() < (process.env.MED_THREE_RATIO || 0.4) ? 3 : 2;
      var drugs = [];
      var symptom = (Math.random() * SYMPTOMS.length) | 0;
      var age = (Math.random() * 100) | 0;
      var gender = (Math.random() * GENDERS.length) | 0;
      var race = (Math.random() * RACES.length) | 0;
      var used = [];
      for (var j = 0; j < num; j++) {
        var rand;
        do {
          rand = (Math.random() * 26) | 0;
        } while (~used.indexOf(rand));
        used.push(rand);
        drugs.push('Drug ' + String.fromCharCode(rand + 65));
      }
      insertData(drugs, symptom, age, gender, race, callback);
    });
  }
  async.series(tasks, function (err) {
    if (err) next(err);
    else res.redirect('/stat');
  })
});

function getCondition(req) {
  return {
    age: (req.cookies.age / 10) | 0,
    gender: req.cookies.gender | 0,
    race: req.cookies.race | 0
  };
}

router.get('/stat', function (req, res, next) {
  var condition = getCondition(req);
  Comb.count(condition, function (err, rows) {
    if (err) return next(err);
    Comb.aggregate([
      {
        $match: condition
      },
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
            var val = rows < 3 ? -1 : calcVal(datum._id, datum.count, rows);
            if (val > THRESHOLD) {
              dataPoints.push({
                y: (val / THRESHOLD * 100).toFixed(2),
                legendText: names.join(' + '),
                label: names.join(' + ')
              });
            }
          });
          res.render('stat', {
            title: 'Medifact - Statistics', dataPoints: dataPoints.sort(function (a, b) {
              return a.y - b.y;
            })
          });
        });
      }
    });
  });
});

module.exports = router;
