'use strict';

const Promise = require('bluebird');
const errors = require('feathers-errors');
const request = require('superagent');
const gcloud = require('gcloud');
const fs = require('fs');
const urlparser = require('url');
const gcs = gcloud.storage({
  projectId: 'You-pin',
  keyFilename: './youpin_gcs_credentials.json'
});
const multer = require('multer');

const CLOUD_BUCKET = 'staging.you-pin.appspot.com';

const uploader = multer({
  inMemory: true,
  fileSize: 5 * 1024 * 1024, // no larger than 5MB
  rename: function(fieldname, filename) {
    // generate a unique filename
    return filename.replace(/\W+/g, '-').toLowerCase() + Date.now();
  }
});

function prepareMultipart(req, res, next) {
  if (req.method.toLowerCase() === 'post') {
    return uploader.single('image')(req, res, next);
  }

  next();
}

function attachFileToFeathers(req, res, next) {
  if (req.method.toLowerCase() === 'post' && req.file) {
    req.feathers.file = req.file;
  }

  next();
}

const bucket = gcs.bucket(CLOUD_BUCKET);

function getPublicUrl (filename) {
  return 'https://storage.googleapis.com/' + CLOUD_BUCKET + '/' + filename;
}

function sendUploadToGCS (req, res, next) {
  if (!req.file) {
    return next();
  }

  const gcsname = Date.now() + '_' + req.file.originalname;
  const file = bucket.file(gcsname);
  const stream = file.createWriteStream();

  stream.on('error', function (err) {
    req.file.cloudStorageError = err;
    next(err);
  });

  stream.on('finish', function () {
    req.file.cloudStorageObject = gcsname;
    req.file.cloudStoragePublicUrl = getPublicUrl(gcsname);
    next();
  });

  stream.end(req.file.buffer);
}

function uploadToGCSPromise(reqFile) {
  return new Promise(function (resolve, reject) {
    if (!reqFile) {
      return reject(new Error('No file provided'));
    }

    const gcsname = Date.now() + '_' + reqFile.originalname;
    const bucketFile = bucket.file(gcsname);
    const stream = bucketFile.createWriteStream();

    stream.on('error', function (err) {
      reqFile.cloudStorageError = err;

      return reject(err);
    });

    stream.on('finish', function () {
      reqFile.cloudStorageObject = gcsname;
      reqFile.cloudStoragePublicUrl = getPublicUrl(gcsname);

      return resolve();
    });

    stream.end(reqFile.buffer);
  });
}

function respondWithImageMetadata(reqFile) {
  return new Promise(function (resolve, reject) {
    // we don't care req.body for now.
    // (care only file content)
    var imageUrl;

    if (reqFile && reqFile.cloudStoragePublicUrl) {
      imageUrl = reqFile.cloudStoragePublicUrl;
    }

    return resolve({
      url: imageUrl,
      mimetype: reqFile.mimetype,
      size: reqFile.size
    });
  });
}

class PhotosService {
  create(data, params) {
    uploadToGCSPromise(data.file)
    .then(() => {
      return respondWithImageMetadata(data.file);
    })
    .catch(function (err) {
      return Promise.reject(err);
    });
  }
}

class UploadPhotoFromUrlService {
  create(data, params) {
    if (typeof data !== 'object') {
      return Promise.reject(new errors.BadRequest('Data must be a JSON object'));
    }

    var photoUrls = [];

    if (Array.isArray(data.urls)) {
      photoUrls = data;
      return Promise.reject(new errors.NotImplemented('Array is not supported yet'));
    } else {
      photoUrls.push(data.urls);
    }

    const url = photoUrls[0];
    // TODO(A): Change to promise and ES6 style
    request
      .head(url)
      .end(function (err, photoHeaderResp) {
        if (err) {
          return Promise.reject(err);
        }
        const pathArray = urlparser.parse(url).pathname.split('/');
        const filename = pathArray[pathArray.length - 1];
        const mimetype = photoHeaderResp.header['content-type'];
        const size = photoHeaderResp.header['content-length'];
        const gcsname = Date.now() + '_' + filename;
        const gcsfile = bucket.file(gcsname);
        const filePublicUrl = getPublicUrl(gcsname);
        console.log('Downloading photo...');
        console.log('Name: ' + filename);
        console.log('Mimetype: ' + mimetype);
        console.log('Size: ' + size);
        console.log('To: ' + filePublicUrl);
        var uploadPipe = request.get(url).pipe(gcsfile.createWriteStream());
        uploadPipe.on('error', function(err) {
          console.log(err);
          return Promise.reject(err);
        });
        uploadPipe.on('finish', function() {
          console.log('Uploading to the cloud starge is complete!');
          return Promise.resolve({
            url: filePublicUrl,
            mimetype: mimetype,
            size: size
          });
        });
      });
  }
}

module.exports = function(){
  const app = this;
  //TODO(A): Need id and need to support multiple photos uplaod
  //TODO(A): Also need to support photo url and download it instead of 3rd party app
  app.use('/photos', prepareMultipart, attachFileToFeathers, new PhotosService());

  // This service receives image url. Then, it downloads and stores image for you.
  // TODO(A): support downloading multiple urls
  app.use('/photos/upload_from_url', new UploadPhotoFromUrlService());
};
