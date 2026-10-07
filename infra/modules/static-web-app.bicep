param name string
param location string
param skuName string = 'Free'
param skuTier string = 'Free'
param tags object = {}

@description('Static Web App resource for hybrid Next.js application (detached deployment)')
resource staticWebApp 'Microsoft.Web/staticSites@2025-05-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {}
}

@description('The Static Web App resource ID')
output resourceId string = staticWebApp.id

@description('The default hostname of the Static Web App')
output defaultHostname string = staticWebApp.properties.defaultHostname
