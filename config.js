/*
 * MGC Jewel Calculator: default configuration.
 *
 * Everything here is editable in the app (Settings) and saved on the device.
 * The calculation engine (engine.js) receives these values as input and never
 * hard-codes any of them, so plan changes never require touching the engine.
 *
 * IMPORTANT: preMonths / postMonths are MONTHS, not payment percentages.
 *
 * `rates` is intentionally empty. Add official floor-wise rates in Settings
 * (or here) once MGC confirms them. The app never invents a rate.
 * Row format: { tower: '1', floor: '5', type: 'Apartment', rate: 0 }
 */
window.JEWEL_DEFAULTS = {
  plans: {
    '1': {
      name: 'Tower 1',
      preMonths: 40,        // months before possession
      postMonths: 20,       // months after possession (total plan = 60)
      balloons: 6,          // number of balloon payments
      balloonsPre: 4,       // how many balloons default to "before possession" (editable per balloon)
      installmentPercent: 1 // % of the discounted price per monthly installment
    },
    '2': {
      name: 'Tower 2',
      preMonths: 50,        // total plan = 70
      postMonths: 20,
      balloons: 8,
      balloonsPre: 6,
      installmentPercent: 1
    }
  },
  unitTypes: ['Apartment', 'Shop'],
  rates: []
};
