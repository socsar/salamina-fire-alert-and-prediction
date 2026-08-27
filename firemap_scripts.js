
  (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
  new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
  'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
  })(window,document,'script','dataLayer','GTM-KDMXGXGG');
  




    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-DEHBCLVBTB');
  


  {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "name": "Global Wildfire Data",
    "description": "A comprehensive dataset combining EFFIS, NASA FIRMS, and national fire agencies for real-time wildfire tracking.",
    "license": "https://creativecommons.org/licenses/by/4.0/",
    "creator": {
      "@type": "Organization",
      "name": "FireMap.live"
    },
    "keywords": "wildfire, real-time, NASA FIRMS, EFFIS, Canada, US, satellite data",
    "distribution": {
      "@type": "DataDownload",
      "encodingFormat": "application/json",
      "contentUrl": "https://firemap.live"
    },
    "temporalCoverage": "2026-01-01T00:00:00Z/2026-12-31T23:59:59Z",
    "spatialCoverage": {
      "@type": "Place",
      "geo": {
        "@type": "GeoCoordinates",
        "latitude": "0",
        "longitude": "0"
      }
    },
    "variableMeasured": [
      {
        "@type": "PropertyValue",
        "name": "Fire Confidence",
        "value": "High"
      }
    ],
    "dataSource": [
      {
        "@type": "Organization",
        "name": "NASA FIRMS",
        "url": "https://firms.modaps.eosdis.nasa.gov"
      }
    ],
    "datePublished": "2023-09-24",
    "url": "https://www.disasterdb.com/firedb",
    "updateFrequency": "PT1H"
  }
  


  {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "name": "GDACS Disaster Alerts",
    "description": "Real-time global disaster alerts from GDACS including earthquakes, tsunamis, floods, and tropical cyclones, processed with data from NASA FIRMS and other authoritative sources.",
    "license": "https://creativecommons.org/licenses/by/4.0/",
    "creator": {
      "@type": "Organization",
      "name": "DisasterDB",
      "url": "https://firemap.live"
    },
    "keywords": [
      "GDACS",
      "disaster alerts",
      "earthquakes",
      "tsunamis",
      "floods",
      "tropical cyclones",
      "global disasters",
      "NASA FIRMS",
      "DisasterDB"
    ],
    "temporalCoverage": "2026-01-01T00:00:00Z/2026-12-31T23:59:59Z",
    "spatialCoverage": {
      "@type": "Place",
      "geo": {
        "@type": "GeoCoordinates",
        "latitude": "0",
        "longitude": "0"
      }
    },
    "variableMeasured": [
      {
        "@type": "PropertyValue",
        "name": "Disaster Type",
        "value": "Earthquake"
      },
      {
        "@type": "PropertyValue",
        "name": "Severity",
        "value": "7.5 Magnitude"
      }
    ],
    "dataSource": [
      {
        "@type": "Organization",
        "name": "GDACS",
        "url": "https://www.gdacs.org"
      },
      {
        "@type": "Organization",
        "name": "NASA FIRMS",
        "url": "https://firms.modaps.eosdis.nasa.gov"
      }
    ],
    "datePublished": "2025-02-26",
    "url": "https://firemap.live",
    "updateFrequency": "PT1H"
  }
  






    setTimeout(() => {
      const mapReady = document.getElementById('map')?.children.length > 0;
      if (!mapReady) {
        document.getElementById('js-error-message').style.display = 'block';
      }
    }, 6000);
  

