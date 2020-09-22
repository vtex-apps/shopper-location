import React, { useEffect, useState, FunctionComponent, Fragment } from 'react'
import { path, compose } from 'ramda'
import { useQuery, useMutation } from 'react-apollo'
import { getParsedAddress } from './helpers/getParsedAddress'
import Address from './graphql/GetOrderForm.graphql'
import Logistics from './graphql/Logistics.graphql'
import UpdateOrderFormShipping from './graphql/UpdateOrderFormShipping.graphql'
import AppSettings from './graphql/AppSettings.graphql'

const hasShippingAddress = compose(Boolean, path(['shippingData', 'address']))

const geolocationOptions = {
  enableHighAccuracy: true,
  maximumAge: 30000,
  timeout: 10000,
}

// const fallbackAddress = {
//   neighborhood: '',
//   complement: '',
//   number: '',
//   street: '',
//   postalCode: '9999999999',
//   city: '',
//   addressType: '',
//   geoCoordinates: [],
//   state: '',
//   receiverName: '',
//   country: '',
// }

const AddressChallenge: FunctionComponent = ({ children }) => {
  const [updateAddress] = useMutation(UpdateOrderFormShipping)
  const { loading, data, refetch } = useQuery(Address, { ssr: false })
  const { data: logisticsData } = useQuery(Logistics, { ssr: false })
  const { data: appSettingsData } = useQuery(AppSettings, {
    variables: {
      version: process.env.VTEX_APP_VERSION,
    },
    ssr: false,
  })
  const [renderChildren, setRenderChildren] = useState(false)

  const requestGoogleMapsApi = async (params: {
    lat: number
    long: number
  }) => {
    const { lat, long } = params
    const baseUrl = `https://maps.googleapis.com/maps/api/geocode/json?key=${logisticsData.logistics.googleMapsKey}&`
    let suffix = ''
    if (lat && long) {
      suffix = `latlng=${lat},${long}`
    }
    try {
      const response = await fetch(baseUrl + suffix)
      return await response.json()
    } catch (err) {
      return { results: [] }
    }
  }

  const handleSuccess = async (position: Position) => {
    // call Google Maps API to get location details from returned coordinates
    const { latitude, longitude } = position.coords
    const parsedResponse = await requestGoogleMapsApi({
      lat: latitude,
      long: longitude,
    })
    if (!parsedResponse.results.length) return

    // save geolocation to orderForm
    // const { shipsTo = [] } = logisticsData?.logistics
    let addressFields = getParsedAddress(parsedResponse.results[0])
    addressFields.number = ''
    addressFields.street = ''
    // if (!shipsTo.includes(addressFields.country)) {
    //   addressFields = fallbackAddress
    //   addressFields.country = shipsTo[0]
    // }
    const { orderFormId } = data.orderForm
    await updateAddress({
      variables: {
        orderFormId,
        address: addressFields,
      },
    })
      .catch(() => null)
      .then(() => {
        const event = new Event('locationUpdated')
        window.dispatchEvent(event)
      })
  }

  const handleError = () => {
    const { geolocationApiKey } = JSON.parse(
      appSettingsData?.appSettings?.message
    )
    if (!geolocationApiKey) return
    // get geolocation from user IP
    fetch(
      `https://ip-geolocation.whoisxmlapi.com/api/v1?apiKey=${geolocationApiKey}`
    )
      .then(res => res.json())
      .then(async res => {
        const { location } = res
        if (!location.lat || !location.lng) return
        const parsedResponse = await requestGoogleMapsApi({
          lat: location.lat,
          long: location.lng,
        })
        if (!parsedResponse.results.length) return

        // const { shipsTo = [] } = logisticsData?.logistics
        let addressFields = getParsedAddress(parsedResponse.results[0])
        addressFields.number = ''
        addressFields.street = ''
        // if (!shipsTo.includes(addressFields.country)) {
        //   addressFields = fallbackAddress
        //   addressFields.country = shipsTo[0]
        // }
        const { orderFormId } = data.orderForm
        await updateAddress({
          variables: {
            orderFormId,
            address: addressFields,
          },
        })
          .catch(() => null)
          .then(() => {
            const event = new Event('locationUpdated')
            window.dispatchEvent(event)
          })
      })
  }

  useEffect(() => {
    const handleLocationUpdated = () => refetch()

    window.addEventListener('locationUpdated', handleLocationUpdated)

    return () => {
      window.removeEventListener('locationUpdated', handleLocationUpdated)
    }
  }, [])

  useEffect(() => {
    if (loading || !data?.orderForm || !logisticsData?.logistics?.googleMapsKey)
      return
    setRenderChildren(true)
    if (hasShippingAddress(data.orderForm)) {
      return
    }
    navigator.geolocation.getCurrentPosition(
      handleSuccess,
      handleError,
      geolocationOptions
    )
  }, [loading, data, logisticsData])

  if (!renderChildren) return null
  return <Fragment>{children}</Fragment>
}

export default AddressChallenge